/**
 * xmtp-wallet.ts
 *
 * Manages a persistent EVM keypair for XMTP messaging.
 *
 * Architecture:
 *   - The Aptos wallet is used ONLY for authentication (connect + address).
 *   - A random EVM keypair is generated on first use and stored in localStorage,
 *     keyed by the Aptos address. This means the same browser + same Aptos account
 *     always produces the same XMTP identity — no `signMessage` required.
 *   - The EVM keypair implements the XMTP browser-sdk v6 EOA Signer interface.
 */

import { ethers } from "ethers";
import { IdentifierKind } from "@xmtp/browser-sdk";
import type { Signer } from "@xmtp/browser-sdk";

const STORAGE_PREFIX = "chattbox_evm_key_";

/** Retrieve or create a persisted EVM wallet for the given Aptos address. */
export function getOrCreateEvmWallet(aptosAddress: string): ethers.Wallet {
  const key = STORAGE_PREFIX + aptosAddress.toLowerCase();
  const stored = localStorage.getItem(key);

  if (stored) {
    return new ethers.Wallet(stored);
  }

  const wallet = ethers.Wallet.createRandom();
  localStorage.setItem(key, wallet.privateKey);
  return wallet;
}

/** Delete the persisted EVM key for a given Aptos address. */
export function clearEvmWallet(aptosAddress: string): void {
  const key = STORAGE_PREFIX + aptosAddress.toLowerCase();
  localStorage.removeItem(key);
}

/**
 * Build an XMTP-compatible EOA signer from an ethers Wallet.
 *
 * Follows the official XMTP docs:
 *   type: "EOA"
 *   getIdentifier: () => Identifier
 *   signMessage: (message: string) => Promise<Uint8Array>
 */
export function createXmtpSigner(evmWallet: ethers.Wallet): Signer {
  return {
    type: "EOA" as const,
    getIdentifier: () => ({
      identifier: evmWallet.address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string): Promise<Uint8Array> => {
      const sig = await evmWallet.signMessage(message);
      return ethers.utils.arrayify(sig);
    },
  };
}
