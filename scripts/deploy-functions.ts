import { spawnSync } from 'node:child_process'
import { FUNCTION_MANIFEST } from '../supabase/functions/_shared/manifest.ts'

export function deployArgs(name: string, verifyJwt: boolean) {
  return ['functions', 'deploy', name, ...(verifyJwt ? [] : ['--no-verify-jwt'])]
}

/** Deploy the exact manifest, preserving each function's gateway-JWT setting. */
export function deployCommands() {
  return FUNCTION_MANIFEST.map(({ name, verifyJwt }) => ['supabase', ...deployArgs(name, verifyJwt)].join(' '))
}

function main() {
  const cli = process.env.SUPABASE_CLI?.trim() || 'npx'
  const prefix = process.env.SUPABASE_CLI?.trim() ? [] : ['--yes', 'supabase']
  for (const { name, verifyJwt } of FUNCTION_MANIFEST) {
    const args = [...prefix, ...deployArgs(name, verifyJwt)]
    console.log(`> ${cli} ${args.join(' ')}`)
    const result = spawnSync(cli, args, { stdio: 'inherit' })
    if (result.error) {
      console.error(`Could not run the Supabase CLI: ${result.error.message}`)
      process.exitCode = 1
      return
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1
      return
    }
  }
}

if (process.argv[1] && /deploy-functions\.ts$/.test(process.argv[1])) main()
