import { error } from './util'

const VERIFIED_IDE_VERSIONS = ['3.10.5']

export function assertSupportedVersion(version: string, allowUnverifiedVersion = false): void {
  if (!allowUnverifiedVersion && !VERIFIED_IDE_VERSIONS.includes(version)) {
    throw error(
      'ERR_UNSUPPORTED_IDE',
      `IDE ${version} is unverified; tested: ${VERIFIED_IDE_VERSIONS.join(', ')}. Set allowUnverifiedVersion to try explicitly.`,
    )
  }
}
