import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy NFTLaunchpad
  console.log("\nDeploying NFTLaunchpad...");
  const NFTLaunchpadFactory = await ethers.getContractFactory("NFTLaunchpad");
  const nftLaunchpad = await NFTLaunchpadFactory.deploy();
  const nftLaunchpadDeployed = await nftLaunchpad.waitForDeployment();
  
  console.log("NFTLaunchpad deployed to:", await nftLaunchpadDeployed.getAddress());
  
  // Log deployment details
  console.log("\nDeployment completed!");
  console.log("====================");
  console.log("NFTLaunchpad:", await nftLaunchpadDeployed.getAddress());
  console.log("\nSet this address in your .env file as LAUNCHPAD_ADDRESS=", await nftLaunchpadDeployed.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
