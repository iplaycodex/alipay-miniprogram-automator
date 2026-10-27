const { error } = require('./util')

const VERIFIED_IDE_VERSIONS = ['3.10.5']

function assertSupportedVersion(version, allowUnverifiedVersion = false) {
  if (!allowUnverifiedVersion && !VERIFIED_IDE_VERSIONS.includes(version)) {
    throw error(
      'ERR_UNSUPPORTED_IDE',
      `IDE ${version} is unverified; tested: ${VERIFIED_IDE_VERSIONS.join(', ')}. Set allowUnverifiedVersion to try explicitly.`,
    )
  }
}

module.exports = { assertSupportedVersion }
