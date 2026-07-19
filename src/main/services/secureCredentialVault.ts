import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { UserSettings } from "../../shared/types.js";

export const SECURE_CREDENTIAL_VAULT_FORMAT = "riftlite.secure-credentials";

type SecureCredentialKey = "firebaseRefreshToken" | "rawCaptureApiKey" | "scorepadDeviceSecret";

type StoredCredential = string | null;

interface SecureCredentialVaultFile {
  format: typeof SECURE_CREDENTIAL_VAULT_FORMAT;
  version: 1;
  entries: Partial<Record<SecureCredentialKey, StoredCredential>>;
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
    version: 1,
    entries: {}
  };
}

function credentialValues(settings: UserSettings): Record<SecureCredentialKey, string> {
  return {
    firebaseRefreshToken: settings.firebaseRefreshToken,
    rawCaptureApiKey: settings.rawCapture.apiKey,
    scorepadDeviceSecret: settings.scorepadDeviceSecret
  };
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
    candidate.version !== 1 ||
    !candidate.entries ||
    typeof candidate.entries !== "object" ||
    Array.isArray(candidate.entries)
  ) {
    return false;
  }
  return Object.entries(candidate.entries).every(([key, entry]) =>
    CREDENTIAL_KEYS.includes(key as SecureCredentialKey) && (typeof entry === "string" || entry === null)
  );
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
 * legacy plaintext value left in the SQLite settings row.
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

      if (!vault) {
        vault = emptyVault();
        for (const key of CREDENTIAL_KEYS) {
          vault.entries[key] = legacyValues[key]
            ? this.encryption.encrypt(legacyValues[key]).toString("base64")
            : null;
        }
        storageChanged = true;
      } else {
        // A missing key can occur when a newer RiftLite release adds another
        // protected field. Migrate only that field; existing entries remain the
        // authority, including explicit null tombstones.
        for (const key of CREDENTIAL_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(vault.entries, key)) {
            vault.entries[key] = legacyValues[key]
              ? this.encryption.encrypt(legacyValues[key]).toString("base64")
              : null;
            storageChanged = true;
          }
        }
      }

      if (storageChanged) {
        await this.writeVault(vault);
      }

      const resolved = this.decryptVault(vault);
      const runtimeSettings = withCredentialValues(settings, resolved);
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
    if (!encryptionAvailable(this.encryption)) {
      return this.unprotected(settings);
    }

    try {
      let vault = await this.readVault();
      if (!vault) {
        vault = emptyVault();
      }
      const values = credentialValues(settings);
      let storageChanged = false;
      for (const key of CREDENTIAL_KEYS) {
        const wasTouched = key === "rawCaptureApiKey"
          ? touched.rawCaptureApiKey
          : touched[key];
        if (!wasTouched && Object.prototype.hasOwnProperty.call(vault.entries, key)) {
          continue;
        }
        vault.entries[key] = values[key]
          ? this.encryption.encrypt(values[key]).toString("base64")
          : null;
        storageChanged = true;
      }
      if (storageChanged) {
        await this.writeVault(vault);
      }
      const runtimeSettings = stripLegacyHubSecrets(withCredentialValues(settings, this.decryptVault(vault)));
      return {
        runtimeSettings,
        persistedSettings: redactSensitiveSettings(runtimeSettings),
        protected: true,
        storageChanged
      };
    } catch (error) {
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
      return this.vaultCache;
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
    this.vaultCache = parsed;
    return parsed;
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
    try {
      await writeFile(temporaryPath, JSON.stringify(vault), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600).catch(() => undefined);
      this.vaultCache = vault;
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
