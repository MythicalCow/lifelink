This is the LifeLink Next.js + Tailwind UI project.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## BLE Bridge Test Page

For hardware integration testing (BLE -> LoRa relay), open:

- [http://localhost:3000/bridge](http://localhost:3000/bridge)

This page supports:

1. Connecting to a node over BLE (through local gateway service).
2. Reading node identity (`WHOAMI`) and setting node name (`NAME|...`).
3. Saving nodes to a local "managed nodes" list.
4. Sending LoRa messages via connected node (`SEND|<dst_hex>|<text>`).

### Start local BLE gateway (required)

The browser no longer uses Web Bluetooth directly. Start a local BLE gateway:

```bash
cd ui
python3 -m pip install -r tools/requirements-ble-gateway.txt
npm run gateway
```

Then run `npm run dev` and open `/bridge`.

You can start editing pages under `src/app/`. The dev server auto-updates.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
