import { run } from "hardhat";

async function verify(contractAddress: string, args: any[]) {
  console.log("Verifying contract...");
  try {
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: args
    });
  } catch (e) {
    if ((e as Error).message.toLowerCase().includes("already verified")) {
      console.log("Already verified!");
    } else {
      console.error("Error verifying contract:", e);
    }
  }
}

async function main() {
  // Get contract addresses from environment variables
  const launchpadAddress = process.env.LAUNCHPAD_ADDRESS;
  const collectionAddress = process.env.COLLECTION_ADDRESS;

  if (!launchpadAddress) {
    throw new Error("Please provide LAUNCHPAD_ADDRESS in environment variables");
  }

  // Verify NFTLaunchpad
  console.log("\nVerifying NFTLaunchpad implementation...");
  await verify(launchpadAddress, []);

  // Verify NFTCollection if address is provided
  if (collectionAddress) {
    // Get constructor arguments from environment variables
    const name = process.env.COLLECTION_NAME;
    const symbol = process.env.COLLECTION_SYMBOL;
    const baseURI = process.env.COLLECTION_BASE_URI;
    const maxSupply = process.env.COLLECTION_MAX_SUPPLY;
    const owner = process.env.COLLECTION_OWNER;

    if (!name || !symbol || !baseURI || !maxSupply || !owner) {
      throw new Error("Missing NFTCollection constructor arguments in environment variables");
    }

    console.log("\nVerifying NFTCollection...");
    await verify(collectionAddress, [
      name,
      symbol,
      baseURI,
      maxSupply,
      owner
    ]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
