const MAC_PUBLISH_CONFIGURATION = Object.freeze({
  provider: "github",
  owner: "cdfpartridge-web",
  repo: "RiftLite-Desktop-Mac"
});

// This must remain an object. electron-builder merges an array override into
// package.json's existing Windows array as numeric properties and retains the
// Windows repository instead of replacing it.
function macReleaseBuildConfig() {
  // electron-builder consumes and mutates this override while merging it, so
  // return a fresh object for every build or verification.
  return {
    publish: { ...MAC_PUBLISH_CONFIGURATION }
  };
}

module.exports = {
  MAC_PUBLISH_CONFIGURATION,
  macReleaseBuildConfig
};
