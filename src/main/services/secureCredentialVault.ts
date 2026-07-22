import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { UserSettings } from "../../shared/types.js";

export const SECURE_CREDENTIAL_VAULT_FORMAT = "riftlite.secure-credentials";

type SecureCredentialKey = "firebaseRefreshToken" | "rawCaptureApiKey" | "scorepadDeviceSecret";

type StoredCredential = string | null;

interface SecureCredentialVaultFile {
  format: typeof SECURE_CREDENTIAL_VAULT_FORMAT;
  version: 1 | 2;
  entries: Partial<Record<SecureCredentialKey, StoredCredential>>;
  firebaseRefreshTokenBinding?: FirebaseCredentialBinding | null;
}

interface FirebaseCredentialBinding {
  firebaseUid: string;
  accountUid: string;
  generation: string;
}

export interface CredentialEncryption {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export interface SensitiveCredentialPatch {
  firebaseRefreshToken: boolean;
  rawCaptureApiKey: boolean;
  scorepadDeviceSecret: boolean;
}

export interface ProtectedSettingsResult {
  runtimeSettings: UserSettings;
  persistedSettings: UserSettings;
  protected: boolean;
  storageChanged: boolean;
}

export function stripLegacyHubSecrets(settings: UserSettings): UserSettings {
  return {
    ...settings,
    activeHubs: settings.activeHubs.map((hub) => {
      const sanitized = { ...hub };
      delete sanitized.passwordHash;
      return sanitized;
    })
  };
}

/** Best-effort scrubbing for the repair copy of a malformed legacy JSON row. */
export function redactCorruptSettingsText(value: string): string {
  return ["firebaseRefreshToken", "firebase_refresh_token", "scorepadDeviceSecret", "apiKey", "passwordHash"]
    .reduce((current, key) => current.replace(
      new RegExp(`("${key}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "gi"),
      "$1\"\""
    ), value);
}

const CREDENTIAL_KEYS: SecureCredentialKey[] = [
  "firebaseRefreshToken",
  "rawCaptureApiKey",
  "scorepadDeviceSecret"
];

function emptyVault(): SecureCredentialVaultFile {
  return {
    format: SECURE_CREDENTIAL_VAULT_FORMAT,
    version: 2,
    entries: {},
    firebaseRefreshTokenBinding: null
  };
}

function cloneVault(vault: SecureCredentialVaultFile): SecureCredentialVaultFile {
  return {
    format: vault.format,
    version: vault.version,
    entries: { ...vault.entries },
    firebaseRefreshTokenBinding: vault.firebaseRefreshTokenBinding
      ? { ...vault.firebaseRefreshTokenBinding }
      : null
  };
}

function firebaseCredentialBinding(settings: UserSettings, generation: string): FirebaseCredentialBinding {
  return {
    firebaseUid: settings.firebaseUid,
    accountUid: settings.accountUid,
    generation
  };
}

function isFirebaseCredentialBinding(value: unknown): value is FirebaseCredentialBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const binding = value as Partial<FirebaseCredentialBinding>;
  return typeof binding.firebaseUid === "string" &&
    typeof binding.accountUid === "string" &&
    typeof binding.generation === "string" &&
    Boolean(binding.generation);
}

function firebaseCredentialBindingMatches(
  binding: FirebaseCredentialBinding | null | undefined,
  settings: UserSettings
): boolean {
  return Boolean(binding) &&
    binding?.firebaseUid === settings.firebaseUid &&
    binding.generation === settings.firebaseCredentialGeneration;
}

class FirebaseCredentialBindingError extends Error {}

function credentialValues(settings: UserSettings): Record<SecureCredentialKey, string> {
  return {
    firebaseRefreshToken: settings.firebaseRefreshToken,
    rawCaptureApiKey: settings.rawCapture.apiKey,
    scorepadDeviceSecret: settings.scorepadDeviceSecret
  };
}

function credentialWasTouched(key: SecureCredentialKey, touched: SensitiveCredentialPatch): boolean {
  return key === "rawCaptureApiKey" ? touched.rawCaptureApiKey : touched[key];
}

function touchedCredentialKeys(touched: SensitiveCredentialPatch): SecureCredentialKey[] {
  return CREDENTIAL_KEYS.filter((key) => credentialWasTouched(key, touched));
}

function withCredentialValues(
  settings: UserSettings,
  values: Record<SecureCredentialKey, string>
): UserSettings {
  return {
    ...settings,
    firebaseRefreshToken: values.firebaseRefreshToken,
    scorepadDeviceSecret: values.scorepadDeviceSecret,
    rawCapture: {
      ...settings.rawCapture,
      apiKey: values.rawCaptureApiKey
    }
  };
}

/**
 * Removes device credentials from a settings snapshot before it is written to
 * the ordinary settings row, an app-data backup, or a cloud backup.
 */
export function redactSensitiveSettings(settings: UserSettings): UserSettings {
  return stripLegacyHubSecrets(withCredentialValues(settings, {
    firebaseRefreshToken: "",
    rawCaptureApiKey: "",
    scorepadDeviceSecret: ""
  }));
}

export function sensitiveCredentialPatch(patch: Partial<UserSettings>): SensitiveCredentialPatch {
  const rawCapture = patch.rawCapture as Partial<UserSettings["rawCapture"]> | undefined;
  return {
    firebaseRefreshToken: Object.prototype.hasOwnProperty.call(patch, "firebaseRefreshToken"),
    rawCaptureApiKey: Boolean(rawCapture && Object.prototype.hasOwnProperty.call(rawCapture, "apiKey")),
    scorepadDeviceSecret: Object.prototype.hasOwnProperty.call(patch, "scorepadDeviceSecret")
  };
}

function isVaultFile(value: unknown): value is SecureCredentialVaultFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<SecureCredentialVaultFile>;
  if (
    candidate.format !== SECURE_CREDENTIAL_VAULT_FORMAT ||
    (candidate.version !== 1 && candidate.version !== 2) ||
    !candidate.entries ||
    typeof candidate.entries !== "object" ||
    Array.isArray(candidate.entries)
  ) {
    return false;
  }
  if (!Object.entries(candidate.entries).every(([key, entry]) =>
    CREDENTIAL_KEYS.includes(key as SecureCredentialKey) && (typeof entry === "string" || entry === null)
  )) {
    return false;
  }
  return candidate.version === 1 ||
    candidate.firebaseRefreshTokenBinding === null ||
    isFirebaseCredentialBinding(candidate.firebaseRefreshTokenBinding);
}

function encryptionAvailable(encryption: CredentialEncryption): boolean {
  try {
    return encryption.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Stores only safeStorage ciphertext in a small sidecar file. A null entry is
 * an intentional tombstone, so an interrupted logout/reset cannot resurrect a
 * legacy plaintext value left in the SQLite settings row. A missing entry is
 * the inverse: plaintext was deliberately saved while safeStorage was
 * unavailable and must be encrypted on the next successful reconciliation.
 */
export class SecureCredentialVault {
  private vaultCache: SecureCredentialVaultFile | null | undefined;

  constructor(
    private readonly filePath: string,
    private readonly encryption: CredentialEncryption
  ) {}

  async reconcile(settings: UserSettings): Promise<ProtectedSettingsResult> {
    if (!encryptionAvailable(this.encryption)) {
      return this.unprotected(settings);
    }

    try {
      let vault = await this.readVault();
      const legacyValues = credentialValues(settings);
      let storageChanged = false;
      let resolvedSettings = settings;

      if (!vault) {
        vault = emptyVault();
        for (const key of CREDENTIAL_KEYS) {
          vault.entries[key] = legacyValues[key]
            ? this.encryption.encrypt(legacyValues[key]).toString("base64")
            : null;
        }
        if (legacyValues.firebaseRefreshToken) {
          const generation = settings.firebaseCredentialGeneration || randomUUID();
          vault.firebaseRefreshTokenBinding = firebaseCredentialBinding(settings, generation);
          resolvedSettings = { ...settings, firebaseCredentialGeneration: generation };
        }
        storageChanged = true;
      } else {
        if (vault.version === 1) {
          vault.version = 2;
          if (vault.entries.firebaseRefreshToken) {
            const generation = settings.firebaseCredentialGeneration || randomUUID();
            vault.firebaseRefreshTokenBinding = firebaseCredentialBinding(settings, generation);
            resolvedSettings = { ...settings, firebaseCredentialGeneration: generation };
          } else {
            vault.firebaseRefreshTokenBinding = null;
          }
          storageChanged = true;
        }
        // A missing key can occur when a newer RiftLite release adds another
        // protected field. Migrate only that field; existing entries remain the
        // authority, including explicit null tombstones.
        for (const key of CREDENTIAL_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(vault.entries, key)) {
            if (key === "firebaseRefreshToken") {
              if (legacyValues.firebaseRefreshToken) {
                const generation = resolvedSettings.firebaseCredentialGeneration || randomUUID();
                vault.entries.firebaseRefreshToken = this.encryption
                  .encrypt(legacyValues.firebaseRefreshToken)
                  .toString("base64");
                vault.firebaseRefreshTokenBinding = firebaseCredentialBinding(resolvedSettings, generation);
                resolvedSettings = { ...resolvedSettings, firebaseCredentialGeneration: generation };
              } else {
                vault.entries.firebaseRefreshToken = null;
                vault.firebaseRefreshTokenBinding = null;
              }
            } else {
              vault.entries[key] = legacyValues[key]
                ? this.encryption.encrypt(legacyValues[key]).toString("base64")
                : null;
            }
            storageChanged = true;
          }
        }
      }

      if (
        vault.entries.firebaseRefreshToken &&
        !firebaseCredentialBindingMatches(vault.firebaseRefreshTokenBinding, resolvedSettings)
      ) {
        // A vault rename and SQLite persistence are separate durable writes.
        // Never hydrate a token whose generation/identity belongs to a
        // different settings commit; fail closed and require reconnection.
        vault.entries.firebaseRefreshToken = null;
        vault.firebaseRefreshTokenBinding = null;
        resolvedSettings = { ...resolvedSettings, firebaseCredentialGeneration: "" };
        storageChanged = true;
      } else if (
        vault.entries.firebaseRefreshToken &&
        vault.firebaseRefreshTokenBinding?.accountUid !== resolvedSettings.accountUid
      ) {
        // Canonical account association may legitimately advance while the
        // authenticated Firebase UID/token stays unchanged.
        vault.firebaseRefreshTokenBinding = firebaseCredentialBinding(
          resolvedSettings,
          resolvedSettings.firebaseCredentialGeneration
        );
        storageChanged = true;
      } else if (!vault.entries.firebaseRefreshToken && resolvedSettings.firebaseCredentialGeneration) {
        vault.firebaseRefreshTokenBinding = null;
        resolvedSettings = { ...resolvedSettings, firebaseCredentialGeneration: "" };
        storageChanged = true;
      }

      if (storageChanged) {
        await this.writeVault(vault);
      }

      const resolved = this.decryptVault(vault);
      const runtimeSettings = withCredentialValues(resolvedSettings, resolved);
      const plaintextWasPresent = CREDENTIAL_KEYS.some((key) => Boolean(legacyValues[key]));
      const legacyHubSecretWasPresent = settings.activeHubs.some((hub) => Boolean(hub.passwordHash));
      return {
        runtimeSettings: stripLegacyHubSecrets(runtimeSettings),
        persistedSettings: redactSensitiveSettings(runtimeSettings),
        protected: true,
        storageChanged: storageChanged || plaintextWasPresent || legacyHubSecretWasPresent
      };
    } catch (error) {
      console.warn("RiftLite secure credential vault was unavailable; keeping the current settings usable", safeError(error));
      return this.unprotected(settings);
    }
  }

  async protectForSave(
    settings: UserSettings,
    touched: SensitiveCredentialPatch
  ): Promise<ProtectedSettingsResult> {
    const values = credentialValues(settings);
    const touchedKeys = touchedCredentialKeys(touched);
    if (!encryptionAvailable(this.encryption)) {
      if (touchedKeys.length > 0) {
        try {
          const vault = await this.readVault() ?? emptyVault();
          for (const key of touchedKeys) {
            if (values[key]) {
              // Absence is a pending-migration marker: the new value remains
              // plaintext only while safeStorage is unavailable, then
              // reconcile encrypts that SQLite value instead of hydrating an
              // older ciphertext or tombstone over it.
              delete vault.entries[key];
            } else {
              // Null remains an authoritative explicit-clear tombstone.
              vault.entries[key] = null;
            }
          }
          if (touched.firebaseRefreshToken) {
            if (vault.version === 2) {
              vault.firebaseRefreshTokenBinding = null;
            } else {
              delete vault.firebaseRefreshTokenBinding;
            }
          }
          await this.writeVault(vault);
        } catch (error) {
          const onlyClears = touchedKeys.every((key) => !values[key]);
          throw new Error(
            onlyClears
              ? "RiftLite could not securely clear the saved credential. The account was left connected; try unlinking again."
              : "RiftLite could not safely stage the new credential while secure storage was unavailable. The previous credential was kept; try again.",
            { cause: error }
          );
        }
      }
      return this.unprotected(touched.firebaseRefreshToken
        ? { ...settings, firebaseCredentialGeneration: "" }
        : settings);
    }

    try {
      let vault = await this.readVault();
      if (!vault) {
        vault = emptyVault();
      }
      let storageChanged = false;
      let resolvedSettings = settings;
      if (vault.version === 1) {
        vault.version = 2;
        if (vault.entries.firebaseRefreshToken) {
          const generation = settings.firebaseCredentialGeneration || randomUUID();
          vault.firebaseRefreshTokenBinding = firebaseCredentialBinding(settings, generation);
          resolvedSettings = { ...settings, firebaseCredentialGeneration: generation };
        } else {
          vault.firebaseRefreshTokenBinding = null;
        }
        storageChanged = true;
      }
      for (const key of CREDENTIAL_KEYS) {
        const wasTouched = credentialWasTouched(key, touched);
        if (!wasTouched && Object.prototype.hasOwnProperty.call(vault.entries, key)) {
          continue;
        }
        if (key === "firebaseRefreshToken") {
          if (wasTouched && values.firebaseRefreshToken) {
            const generation = randomUUID();
            vault.entries.firebaseRefreshToken = this.encryption.encrypt(values.firebaseRefreshToken).toString("base64");
            vault.firebaseRefreshTokenBinding = firebaseCredentialBinding(settings, generation);
            resolvedSettings = { ...settings, firebaseCredentialGeneration: generation };
          } else if (wasTouched) {
            vault.entries.firebaseRefreshToken = null;
            vault.firebaseRefreshTokenBinding = null;
            resolvedSettings = { ...settings, firebaseCredentialGeneration: "" };
          } else if (values.firebaseRefreshToken) {
            const generation = resolvedSettings.firebaseCredentialGeneration || randomUUID();
            vault.entries.firebaseRefreshToken = this.encryption.encrypt(values.firebaseRefreshToken).toString("base64");
            vault.firebaseRefreshTokenBinding = firebaseCredentialBinding(resolvedSettings, generation);
            resolvedSettings = { ...resolvedSettings, firebaseCredentialGeneration: generation };
          } else {
            vault.entries.firebaseRefreshToken = null;
            vault.firebaseRefreshTokenBinding = null;
          }
        } else {
          vault.entries[key] = values[key]
            ? this.encryption.encrypt(values[key]).toString("base64")
            : null;
        }
        storageChanged = true;
      }
      if (
        !touched.firebaseRefreshToken &&
        vault.entries.firebaseRefreshToken &&
        !firebaseCredentialBindingMatches(vault.firebaseRefreshTokenBinding, resolvedSettings)
      ) {
        throw new FirebaseCredentialBindingError(
          "The linked account identity changed without a matching credential update. Reconnect the account instead."
        );
      }
      if (
        !touched.firebaseRefreshToken &&
        vault.entries.firebaseRefreshToken &&
        vault.firebaseRefreshTokenBinding?.accountUid !== resolvedSettings.accountUid
      ) {
        vault.firebaseRefreshTokenBinding = firebaseCredentialBinding(
          resolvedSettings,
          resolvedSettings.firebaseCredentialGeneration
        );
        storageChanged = true;
      }
      if (storageChanged) {
        await this.writeVault(vault);
      }
      const runtimeSettings = stripLegacyHubSecrets(withCredentialValues(resolvedSettings, this.decryptVault(vault)));
      return {
        runtimeSettings,
        persistedSettings: redactSensitiveSettings(runtimeSettings),
        protected: true,
        storageChanged
      };
    } catch (error) {
      if (error instanceof FirebaseCredentialBindingError) {
        throw error;
      }
      if (touchedKeys.length > 0) {
        throw new Error(
          "RiftLite could not update secure credential storage. The account change was not saved; try again.",
          { cause: error }
        );
      }
      console.warn("RiftLite could not update secure credential storage; using the existing settings fallback", safeError(error));
      return this.unprotected(settings);
    }
  }

  private unprotected(settings: UserSettings): ProtectedSettingsResult {
    return {
      runtimeSettings: settings,
      persistedSettings: settings,
      protected: false,
      storageChanged: false
    };
  }

  private async readVault(): Promise<SecureCredentialVaultFile | null> {
    if (this.vaultCache !== undefined) {
      return this.vaultCache ? cloneVault(this.vaultCache) : null;
    }
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.vaultCache = null;
        return null;
      }
      throw error;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isVaultFile(parsed)) {
      throw new Error("Secure credential file has an unsupported format");
    }
    this.vaultCache = cloneVault(parsed);
    return cloneVault(parsed);
  }

  private decryptVault(vault: SecureCredentialVaultFile): Record<SecureCredentialKey, string> {
    return Object.fromEntries(CREDENTIAL_KEYS.map((key) => {
      const entry = vault.entries[key];
      if (!entry) {
        return [key, ""];
      }
      return [key, this.encryption.decrypt(Buffer.from(entry, "base64"))];
    })) as Record<SecureCredentialKey, string>;
  }

  private async writeVault(vault: SecureCredentialVaultFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const durableVault = cloneVault(vault);
    try {
      await writeFile(temporaryPath, JSON.stringify(durableVault), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600).catch(() => undefined);
      this.vaultCache = cloneVault(durableVault);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
