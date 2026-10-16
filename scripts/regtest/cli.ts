import {
  BIP84,
  BIP86,
  buildFixture,
  ELECTRUM_WS,
  mine,
  reorg,
  rpc,
} from "./fixture";

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "fund": {
    const [address, amount = "1"] = args;
    if (!address) throw new Error("Usage: regtest:fund <address> [btc]");
    console.log(await rpc("sendtoaddress", address, Number(amount)));
    break;
  }
  case "mine":
    await mine(Number(args[0] ?? 1));
    console.log(`Mined to height ${await rpc("getblockcount")}`);
    break;
  case "reorg":
    await reorg(Number(args[0] ?? 1));
    console.log(`Reorganised to height ${await rpc("getblockcount")}`);
    break;
  case "fixture":
    await buildFixture();
    console.log(`Electrum: ${ELECTRUM_WS}\nBIP84: ${BIP84.text}\nBIP86: ${BIP86.text}`);
    break;
  default:
    throw new Error("Usage: cli.ts fund|mine|reorg|fixture");
}
