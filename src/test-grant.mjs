/**
 * Operator's standing TEST-ENVIRONMENT attestation.
 *
 * This is a single server-side switch for the entire private Pikete QA phase:
 * node B / C, multiple phones, and Panitas all share the same server policy.
 * It never trusts client-supplied rights claims and never overrides revoked or
 * blocked items. Production remains denied without a per-video grant.
 *
 * Only activate this in an isolated environment with permission to download
 * and redistribute ALL audio included in that environment's tests.
 */
export function isPrivateTestGrantActive(env=process.env) {
  return env.PIKETE_TEST_MODE === 'true' &&
    env.PIKETE_TEST_RIGHTS_ATTESTED === 'true' &&
    env.PIKETE_YOUTUBE_INGEST_ENABLED === 'true' &&
    env.PIKETE_ARCHIVE_UPLOADS_ENABLED === 'true';
}
