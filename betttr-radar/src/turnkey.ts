/**
 * Turnkey custodial Solana wallets — same pattern as vrsz-core.
 * Runs on Hetzner betttr-radar. Keys never leave Turnkey.
 */
import { randomBytes } from 'node:crypto';
import { Turnkey } from '@turnkey/sdk-server';

function optional(name: string): string {
  return (process.env[name] ?? '').trim();
}

const turnkeyApiPublicKey = optional('TURNKEY_API_PUBLIC_KEY');
const turnkeyApiPrivateKey = optional('TURNKEY_API_PRIVATE_KEY');
const turnkeyOrganizationId = optional('TURNKEY_ORGANIZATION_ID');
const turnkeyBackupApiPublicKey = optional('TURNKEY_BACKUP_API_PUBLIC_KEY');

export type ProvisionedWallet = {
  turnkeySubOrgId: string;
  turnkeyWalletId: string;
  address: string;
  devMode: boolean;
};

export function turnkeyConfigured() {
  return Boolean(turnkeyApiPublicKey && turnkeyApiPrivateKey && turnkeyOrganizationId);
}

function serverApiKeyParams() {
  return {
    apiKeyName: 'betttr-server',
    publicKey: turnkeyApiPublicKey,
    curveType: 'API_KEY_CURVE_P256' as const,
  };
}

function backupApiKeyParams() {
  return {
    apiKeyName: 'betttr-server-backup',
    publicKey: turnkeyBackupApiPublicKey,
    curveType: 'API_KEY_CURVE_P256' as const,
  };
}

function rootUserApiKeys() {
  const keys = [serverApiKeyParams()];
  if (turnkeyBackupApiPublicKey) keys.push(backupApiKeyParams());
  return keys;
}

function devWallet(userId: string): ProvisionedWallet {
  const suffix = randomBytes(16).toString('base64url').slice(0, 32);
  return {
    turnkeySubOrgId: `dev-suborg-${userId.slice(0, 8)}`,
    turnkeyWalletId: `dev-wallet-${userId.slice(0, 8)}`,
    address: `DEV${suffix}`,
    devMode: true,
  };
}

function turnkeyClient(organizationId = turnkeyOrganizationId) {
  return new Turnkey({
    apiBaseUrl: 'https://api.turnkey.com',
    apiPublicKey: turnkeyApiPublicKey,
    apiPrivateKey: turnkeyApiPrivateKey,
    defaultOrganizationId: organizationId,
  }).apiClient();
}

function subOrgTurnkeyClient(subOrgId: string) {
  return turnkeyClient(subOrgId);
}

export class SubOrgServerKeyMissingError extends Error {
  readonly subOrgId: string;

  constructor(subOrgId: string) {
    super(
      `Wallet sub-org ${subOrgId} does not contain the current server API key. ` +
        `Re-create the wallet under the current Turnkey keys.`,
    );
    this.name = 'SubOrgServerKeyMissingError';
    this.subOrgId = subOrgId;
  }
}

export async function subOrgHasServerKey(subOrgId: string): Promise<boolean> {
  if (!turnkeyConfigured()) return false;
  try {
    const parentApi = turnkeyClient(turnkeyOrganizationId);
    const usersResponse = await parentApi.getUsers({ organizationId: subOrgId });
    return (usersResponse.users ?? []).some((user) =>
      (user.apiKeys ?? []).some(
        (k) => k.credential?.publicKey === turnkeyApiPublicKey,
      ),
    );
  } catch {
    return false;
  }
}

export async function assertSubOrgServerAccess(subOrgId: string) {
  if (await subOrgHasServerKey(subOrgId)) return;
  throw new SubOrgServerKeyMissingError(subOrgId);
}

function turnkeyOrgMismatchHint(subOrgId: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('ORGANIZATION_MISMATCH')) {
    return err instanceof Error ? err : new Error(msg);
  }
  return new SubOrgServerKeyMissingError(subOrgId);
}

/** One custodial Solana wallet per user via Turnkey sub-org. */
export async function provisionCustodialWallet(
  userId: string,
  username: string,
): Promise<ProvisionedWallet> {
  if (!turnkeyConfigured()) {
    console.warn(
      '[turnkey] keys missing — using dev wallet placeholder. Set TURNKEY_* on Hetzner .env',
    );
    return devWallet(userId);
  }

  const safeName =
    username.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || userId.slice(0, 8);
  const email = `${safeName}@users.betttr.xyz`;
  const api = turnkeyClient(turnkeyOrganizationId);
  const response = await api.createSubOrganization({
    subOrganizationName: `betttr-${safeName}`,
    rootUsers: [
      {
        userName: safeName,
        userEmail: email,
        apiKeys: rootUserApiKeys(),
        authenticators: [],
        oauthProviders: [],
      },
    ],
    rootQuorumThreshold: 1,
    wallet: {
      walletName: 'betttr SOL wallet',
      accounts: [
        {
          curve: 'CURVE_ED25519',
          pathFormat: 'PATH_FORMAT_BIP32',
          path: "m/44'/501'/0'/0'",
          addressFormat: 'ADDRESS_FORMAT_SOLANA',
        },
      ],
    },
  });

  const address = response.wallet?.addresses?.[0];
  if (!response.subOrganizationId || !response.wallet?.walletId || !address) {
    throw new Error('Turnkey wallet provisioning returned incomplete data');
  }

  return {
    turnkeySubOrgId: response.subOrganizationId,
    turnkeyWalletId: response.wallet.walletId,
    address,
    devMode: false,
  };
}

/** Export Solana private key encrypted to the browser Turnkey iframe TEK. */
export async function exportWalletAccountBundle(input: {
  subOrgId: string;
  walletId: string;
  address: string;
  targetPublicKey: string;
}) {
  if (!turnkeyConfigured()) {
    throw new Error('Turnkey is not configured on this server');
  }

  // Skip slow getUsers preflight — export fails with ORGANIZATION_MISMATCH if key missing.
  const api = subOrgTurnkeyClient(input.subOrgId);
  try {
    const response = await api.exportWalletAccount({
      organizationId: input.subOrgId,
      address: input.address,
      targetPublicKey: input.targetPublicKey,
    });

    const exportBundle = response.exportBundle;
    if (!exportBundle) {
      throw new Error('Turnkey export returned no bundle');
    }

    return { exportBundle, organizationId: input.subOrgId };
  } catch (err) {
    throw turnkeyOrgMismatchHint(input.subOrgId, err);
  }
}

export { subOrgTurnkeyClient };
