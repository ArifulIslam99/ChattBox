# ChattBox

ChattBox is a React + TypeScript chat app that connects Aptos users to XMTP direct messaging.

It uses Aptos wallet connection for authentication and an XMTP-compatible EVM signer for messaging.

---

## Tech Stack

- React 19 + TypeScript + Vite
- `@aptos-labs/wallet-adapter-react` for Aptos wallet connection
- `@xmtp/browser-sdk` (v6) for messaging
- `ethers` for EVM key handling
- `vite-plugin-node-polyfills` for browser compatibility

---

## How it works

### 1) Wallet connection

- User connects an Aptos wallet in the browser.
- Aptos wallet is used for session/auth UX only.

### 2) XMTP identity

- On first connection, the app creates an EVM keypair and stores it in `localStorage` under a key derived from the Aptos address.
- On later sessions in the same browser profile, the same EVM key is reused.
- This EVM identity is used as the XMTP signer (`type: "EOA"`).

### 3) Messaging flow

- App creates XMTP client on `production` network.
- Loads DMs with `listDms()`.
- Starts/opens DMs via recipient EVM address.
- Sends text with `sendText()`.
- Streams live messages with `streamAllDmMessages()`.

---

## Why this architecture

Some Aptos account types (such as MultiKey/Keyless in certain wallet paths) can fail with wallet `signMessage` flows. ChattBox avoids this class of issue by using a browser-persisted EVM signer for XMTP while still using Aptos wallet connection as the user’s entry/auth experience.

---

## Project structure

- `src/App.tsx` — Main UI and wallet/XMTP boot flow
- `src/hooks/useXMTP.ts` — XMTP client lifecycle, DM actions, and streams
- `src/lib/xmtp-wallet.ts` — Persistent EVM key management + XMTP signer creation
- `src/main.tsx` — React root + Aptos wallet provider

---

## Getting started

### Prerequisites

- Node.js 18+
- npm
- An Aptos browser wallet extension (Petra or any compatible wallet)

### Install

```bash
npm install
```

### Run dev server

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

---

## How to test chat locally (2 browser profiles)

1. Open app in Profile A and connect Aptos wallet.
2. Copy the **Your XMTP address** shown in the sidebar (it should be lowercase `0x...`).
3. Open app in Profile B and connect a different Aptos wallet.
4. Copy Profile B’s XMTP address.
5. In Profile A, click **New Conversation**, paste Profile B address, and start chat.
6. Repeat reverse direction if needed.

---

## Troubleshooting

### "This address is not registered on XMTP yet"

- Ensure the recipient has opened the app and completed XMTP initialization.
- Use the exact lowercase XMTP address displayed in the app.
- Make sure both users are on the same XMTP environment (`production`).

### No wallet found

- Install and enable an Aptos wallet extension.
- Refresh the page after installing.

### Conversation not updating in real time

- Keep both tabs open and connected.
- Refresh once if stream was interrupted.

---

## Notes

- EVM keys are stored in browser `localStorage` and are profile-specific.
- Clearing browser storage creates a new XMTP identity for that Aptos account in that browser.
- Current app scope is DM only (no group chat UI).
