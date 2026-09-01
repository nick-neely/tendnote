import { compileDeclarativeMatchers, type DeepsecPlugin } from "deepsec/config";

const specs = [
  {
    "version": 1,
    "slug": "tendnote-owner-action-module",
    "description": "Detects Tendnote's dedicated Next.js Server Action modules that use the shared authenticated owner-action boundary.",
    "noiseTier": "precise",
    "filePatterns": [
      "apps/web/src/app/actions/*.ts"
    ],
    "requires": {
      "sentinelFiles": [
        "apps/web/next.config.ts"
      ]
    },
    "patterns": [
      {
        "source": "^[\"']use server[\"'];\\r?\\n[\\s\\S]*?\\nimport \\{[^\\r\\n]*\\brunOwnerAction\\b[^\\r\\n]*\\} from [\"']@/lib/owner-action[\"'];",
        "label": "Tendnote owner-scoped Server Action module"
      }
    ],
    "excludeFilePatterns": [
      "apps/web/src/app/actions/*.test.ts"
    ],
    "examples": [
      "\"use server\";\n\nimport { runOwnerAction } from \"@/lib/owner-action\";"
    ],
    "closesSurfaceIds": [
      "next-server-actions"
    ]
  },
  {
    "version": 1,
    "slug": "vercel-flags-discovery-route",
    "description": "Detects the Next.js GET registration created by Vercel's authenticated Flags discovery endpoint primitive.",
    "noiseTier": "precise",
    "filePatterns": [
      "apps/web/src/app/.well-known/vercel/flags/route.ts"
    ],
    "requires": {
      "sentinelFiles": [
        "apps/web/next.config.ts"
      ]
    },
    "patterns": [
      {
        "source": "^export const GET\\s*=\\s*createFlagsDiscoveryEndpoint\\(",
        "flags": "m",
        "label": "Vercel Flags discovery GET registration"
      }
    ],
    "examples": [
      "export const GET = createFlagsDiscoveryEndpoint(async () => {"
    ],
    "closesSurfaceIds": [
      "vercel-flags-discovery"
    ]
  },
  {
    "version": 1,
    "slug": "eve-channel-registration",
    "description": "Detects the exported Eve chat channel registration with hosted admission auth and loopback-only local auth.",
    "noiseTier": "precise",
    "filePatterns": [
      "apps/agent/agent/channels/eve.ts"
    ],
    "requires": {
      "sentinelFiles": [
        "apps/agent/package.json"
      ]
    },
    "patterns": [
      {
        "source": "^export default eveChannel\\(\\{ auth: \\[hostedSessionAuth, createLocalOwnerAuth\\(\\)\\] \\}\\);$",
        "flags": "m",
        "label": "Authenticated Eve channel registration"
      }
    ],
    "examples": [
      "export default eveChannel({ auth: [hostedSessionAuth, createLocalOwnerAuth()] });"
    ],
    "closesSurfaceIds": [
      "eve-chat-channel"
    ]
  },
  {
    "version": 1,
    "slug": "tendnote-better-auth-http-registration",
    "description": "Detects Tendnote's Next.js GET/POST route registration that dispatches requests to the Better Auth handler.",
    "noiseTier": "precise",
    "filePatterns": [
      "apps/web/src/app/api/auth/**/route.ts"
    ],
    "requires": {
      "sentinelFiles": [
        "apps/web/next.config.ts",
        "packages/auth/src/server.ts"
      ]
    },
    "patterns": [
      {
        "source": "^export \\{ handler as GET, handler as POST \\};$",
        "label": "Better Auth Next.js GET/POST registration"
      }
    ],
    "examples": [
      "export { handler as GET, handler as POST };"
    ],
    "closesSurfaceIds": [
      "better-auth-http"
    ]
  },
  {
    "version": 1,
    "slug": "tendnote-next-action-directive",
    "description": "Detects Tendnote's dedicated Next.js Server Action modules through their module-level server directive.",
    "noiseTier": "precise",
    "filePatterns": [
      "apps/web/src/app/actions/*.ts"
    ],
    "requires": {
      "sentinelFiles": [
        "apps/web/next.config.ts",
        "apps/web/src/lib/owner-action.ts"
      ]
    },
    "patterns": [
      {
        "source": "^[\"']use server[\"'];\\r?$",
        "flags": "m",
        "label": "Next.js Server Action module directive"
      }
    ],
    "excludeFilePatterns": [
      "apps/web/src/app/actions/*.test.ts"
    ],
    "examples": [
      "\"use server\";"
    ],
    "closesSurfaceIds": [
      "next-server-actions"
    ]
  },
  {
    "version": 1,
    "slug": "tendnote-vercel-queue-callback-factory",
    "description": "Matches Tendnote's shared Vercel Queue callback factory at its concrete handleCallback registration.",
    "noiseTier": "precise",
    "filePatterns": [
      "apps/web/src/lib/background-jobs/queue-runtime.ts"
    ],
    "patterns": [
      {
        "source": "^\\s*return\\s+handleCallback\\s*\\(",
        "flags": "m",
        "label": "Vercel Queue callback registration"
      }
    ],
    "examples": [
      "  return handleCallback("
    ],
    "closesSurfaceIds": [
      "vercel-queue-consumers"
    ]
  },
  {
    "version": 1,
    "slug": "tendnote-publication-qualification-cli",
    "description": "Matches the executable and argument-processing entry points of Tendnote's Node publication-qualification CLI.",
    "noiseTier": "precise",
    "filePatterns": [
      "scripts/publication-qualification.mjs",
      "scripts/publication-qualification/cli.mjs"
    ],
    "patterns": [
      {
        "source": "^#!\\s*/usr/bin/env\\s+node\\s*$",
        "flags": "m",
        "label": "Node CLI executable entry point"
      },
      {
        "source": "\\bprocess\\.argv(?:\\s*\\[\\s*\\d+\\s*\\]|\\s*\\.\\s*indexOf\\s*\\()",
        "label": "Node CLI argument dispatch"
      }
    ],
    "examples": [
      "#!/usr/bin/env node",
      "process.argv[1]",
      "process.argv.indexOf(name)"
    ],
    "closesSurfaceIds": [
      "operator-and-ci-cli"
    ]
  }
];

export const generatedMatchersPlugin: DeepsecPlugin = {
  name: "deepsec-generated-matchers",
  matchers: compileDeclarativeMatchers(specs),
};
