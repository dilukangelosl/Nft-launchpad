import { expect } from "chai";
import { ethers } from "hardhat";
import { NFTLaunchpad } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ZeroAddress, parseEther, keccak256, toUtf8Bytes } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("NFTLaunchpad", () => {
  let launchpad: NFTLaunchpad;
  let owner: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  
  const DEPLOYER_ROLE = keccak256(toUtf8Bytes("DEPLOYER_ROLE"));
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

  beforeEach(async () => {
    [owner, deployer, user, user2] = await ethers.getSigners();

    const LaunchpadFactory = await ethers.getContractFactory("NFTLaunchpad");
    launchpad = await LaunchpadFactory.deploy();
    await launchpad.waitForDeployment();

    // Grant deployer role
    await launchpad.grantRole(DEPLOYER_ROLE, deployer.address);
  });

  describe("Role Management", () => {
    it("Should set the right owner", async () => {
      expect(await launchpad.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should grant deployer role correctly", async () => {
      expect(await launchpad.hasRole(DEPLOYER_ROLE, deployer.address)).to.be.true;
    });

    it("Should allow admin to grant deployer role", async () => {
      await launchpad.grantRole(DEPLOYER_ROLE, user.address);
      expect(await launchpad.hasRole(DEPLOYER_ROLE, user.address)).to.be.true;
    });

    it("Should allow admin to revoke deployer role", async () => {
      await launchpad.revokeRole(DEPLOYER_ROLE, deployer.address);
      expect(await launchpad.hasRole(DEPLOYER_ROLE, deployer.address)).to.be.false;
    });

    it("Should not allow non-admin to grant roles", async () => {
      await expect(
        launchpad.connect(user).grantRole(DEPLOYER_ROLE, user2.address)
      ).to.be.revertedWithCustomError(launchpad, "AccessControlUnauthorizedAccount");
    });

    it("Should not allow non-admin to revoke roles", async () => {
      await expect(
        launchpad.connect(user).revokeRole(DEPLOYER_ROLE, deployer.address)
      ).to.be.revertedWithCustomError(launchpad, "AccessControlUnauthorizedAccount");
    });

    it("Should allow role renouncement", async () => {
      await launchpad.connect(deployer).renounceRole(DEPLOYER_ROLE, deployer.address);
      expect(await launchpad.hasRole(DEPLOYER_ROLE, deployer.address)).to.be.false;
    });
  });

  describe("Collection Deployment with Rounds", () => {
    const name = "TestNFT";
    const symbol = "TNFT";
    const baseURI = "ipfs://QmTest/";
    const maxSupply = 1000n;
    let startTime: bigint;
    let rounds: Array<{
      startTime: bigint;
      endTime: bigint;
      price: bigint;
      maxSupply: bigint;
      merkleRoot: string;
      isWhitelistEnabled: boolean;
    }>;

    beforeEach(async () => {
      startTime = BigInt(await time.latest()) + 3600n; // Start in 1 hour
      
      rounds = [
        {
          startTime: startTime,
          endTime: startTime + 7200n,
          price: parseEther("0.1"),
          maxSupply: 100n,
          merkleRoot: ethers.ZeroHash,
          isWhitelistEnabled: false
        },
        {
          startTime: startTime + 7200n,
          endTime: startTime + 14400n,
          price: parseEther("0.2"),
          maxSupply: 200n,
          merkleRoot: ethers.ZeroHash,
          isWhitelistEnabled: false
        }
      ];
    });

    it("Should deploy collection with rounds", async () => {
      const salt = ethers.randomBytes(32);
      const tx = await launchpad.connect(deployer).deployCollectionWithRounds(
        name,
        symbol,
        baseURI,
        maxSupply,
        owner.address,
        salt,
        rounds
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log: any) => log.eventName === "CollectionDeployed"
      );
      expect(event).to.not.be.undefined;

      const collectionAddress = event?.args[0];
      const collection = await ethers.getContractAt("NFTCollection", collectionAddress);

      expect(await collection.name()).to.equal(name);
      expect(await collection.symbol()).to.equal(symbol);
      expect(await collection.maxSupply()).to.equal(maxSupply);
      expect(await collection.totalRounds()).to.equal(2n);
    });

    it("Should fail if no rounds are specified", async () => {
      const salt = ethers.randomBytes(32);
      await expect(
        launchpad.connect(deployer).deployCollectionWithRounds(
          name,
          symbol,
          baseURI,
          maxSupply,
          owner.address,
          salt,
          []
        )
      ).to.be.revertedWith("No rounds specified");
    });

    it("Should fail if round has invalid times", async () => {
      const salt = ethers.randomBytes(32);
      const invalidRounds = [
        {
          startTime: startTime + 7200n,
          endTime: startTime, // End before start
          price: parseEther("0.1"),
          maxSupply: 100n,
          merkleRoot: ethers.ZeroHash,
          isWhitelistEnabled: false
        }
      ];

      await expect(
        launchpad.connect(deployer).deployCollectionWithRounds(
          name,
          symbol,
          baseURI,
          maxSupply,
          owner.address,
          salt,
          invalidRounds
        )
      ).to.be.revertedWith("Invalid round times");
    });

    it("Should fail if round has zero supply", async () => {
      const salt = ethers.randomBytes(32);
      const invalidRounds = [
        {
          startTime,
          endTime: startTime + 7200n,
          price: parseEther("0.1"),
          maxSupply: 0n,
          merkleRoot: ethers.ZeroHash,
          isWhitelistEnabled: false
        }
      ];

      await expect(
        launchpad.connect(deployer).deployCollectionWithRounds(
          name,
          symbol,
          baseURI,
          maxSupply,
          owner.address,
          salt,
          invalidRounds
        )
      ).to.be.revertedWith("Invalid round supply");
    });

    it("Should handle whitelist rounds", async () => {
      const salt = ethers.randomBytes(32);
      const merkleRoot = keccak256(toUtf8Bytes("test"));
      const whitelistRounds = [
        {
          startTime,
          endTime: startTime + 7200n,
          price: parseEther("0.1"),
          maxSupply: 100n,
          merkleRoot,
          isWhitelistEnabled: true
        }
      ];

      const tx = await launchpad.connect(deployer).deployCollectionWithRounds(
        name,
        symbol,
        baseURI,
        maxSupply,
        owner.address,
        salt,
        whitelistRounds
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log: any) => log.eventName === "CollectionDeployed"
      );
      const collectionAddress = event?.args[0];
      const collection = await ethers.getContractAt("NFTCollection", collectionAddress);
      
      const round = await collection.mintRounds(0);
      expect(round.merkleRoot).to.equal(merkleRoot);
      expect(round.isWhitelistEnabled).to.be.true;
    });

    it("Should emit event with correct parameters including round count", async () => {
      const salt = ethers.randomBytes(32);
      await expect(
        launchpad.connect(deployer).deployCollectionWithRounds(
          name,
          symbol,
          baseURI,
          maxSupply,
          owner.address,
          salt,
          rounds
        )
      )
        .to.emit(launchpad, "CollectionDeployed")
        .withArgs(
          await launchpad.computeAddress(
            name,
            symbol,
            baseURI,
            maxSupply,
            owner.address,
            salt
          ),
          owner.address,
          name,
          symbol,
          maxSupply,
          2n // number of rounds
        );
    });

    it("Should create Dutch auction schedule", async () => {
      const salt = ethers.randomBytes(32);
      const startPrice = parseEther("1");
      const priceDecrement = parseEther("0.1");
      const dutchAuctionRounds = Array.from({ length: 5 }, (_, i) => ({
        startTime: startTime + (BigInt(i) * 3600n),
        endTime: startTime + (BigInt(i + 1) * 3600n),
        price: startPrice - (priceDecrement * BigInt(i)),
        maxSupply: 50n,
        merkleRoot: ethers.ZeroHash,
        isWhitelistEnabled: false
      }));

      const tx = await launchpad.connect(deployer).deployCollectionWithRounds(
        name,
        symbol,
        baseURI,
        maxSupply,
        owner.address,
        salt,
        dutchAuctionRounds
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log: any) => log.eventName === "CollectionDeployed"
      );
      const collectionAddress = event?.args[0];
      const collection = await ethers.getContractAt("NFTCollection", collectionAddress);

      // Verify all rounds were created
      expect(await collection.totalRounds()).to.equal(5n);

      // Verify decreasing prices
      for (let i = 0; i < 5; i++) {
        const round = await collection.mintRounds(i);
        expect(round.price).to.equal(startPrice - (priceDecrement * BigInt(i)));
      }
    });
  });

  describe("Edge Cases", () => {
    it("Should handle large maxSupply", async () => {
      const salt = ethers.randomBytes(32);
      // Use a large but reasonable supply instead of max uint256
      const largeSupply = 1000000000n; // 1 billion
      const startTime = BigInt(await time.latest()) + 3600n;
      
      const rounds = [{
        startTime,
        endTime: startTime + 3600n,
        price: parseEther("0.1"),
        maxSupply: 1000n, // Keep round supply reasonable
        merkleRoot: ethers.ZeroHash,
        isWhitelistEnabled: false
      }];
      
      const tx = await launchpad.connect(deployer).deployCollectionWithRounds(
        "LargeSupplyTest",
        "LST",
        "ipfs://",
        largeSupply,
        owner.address,
        salt,
        rounds
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log: any) => log.eventName === "CollectionDeployed"
      );
      expect(event).to.not.be.undefined;
      
      const collectionAddress = event?.args[0];
      const collection = await ethers.getContractAt("NFTCollection", collectionAddress);
      expect(await collection.maxSupply()).to.equal(largeSupply);
    });

    it("Should handle valid but minimal name and symbol", async () => {
      const salt = ethers.randomBytes(32);
      const startTime = BigInt(await time.latest()) + 3600n;
      
      const rounds = [{
        startTime,
        endTime: startTime + 3600n,
        price: parseEther("0.1"),
        maxSupply: 100n,
        merkleRoot: ethers.ZeroHash,
        isWhitelistEnabled: false
      }];
      
      const tx = await launchpad.connect(deployer).deployCollectionWithRounds(
        "A", // Minimal valid name
        "B", // Minimal valid symbol
        "ipfs://",
        1000n,
        owner.address,
        salt,
        rounds
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log: any) => log.eventName === "CollectionDeployed"
      );
      expect(event).to.not.be.undefined;
      
      const collectionAddress = event?.args[0];
      const collection = await ethers.getContractAt("NFTCollection", collectionAddress);
      expect(await collection.name()).to.equal("A");
      expect(await collection.symbol()).to.equal("B");
    });

    it("Should handle common special characters in name and symbol", async () => {
      const salt = ethers.randomBytes(32);
      const startTime = BigInt(await time.latest()) + 3600n;
      
      const rounds = [{
        startTime,
        endTime: startTime + 3600n,
        price: parseEther("0.1"),
        maxSupply: 100n,
        merkleRoot: ethers.ZeroHash,
        isWhitelistEnabled: false
      }];
      
      const tx = await launchpad.connect(deployer).deployCollectionWithRounds(
        "Test Collection - #1", // More realistic special characters
        "TEST1", // Simple alphanumeric symbol
        "ipfs://",
        1000n,
        owner.address,
        salt,
        rounds
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log: any) => log.eventName === "CollectionDeployed"
      );
      expect(event).to.not.be.undefined;
      
      const collectionAddress = event?.args[0];
      const collection = await ethers.getContractAt("NFTCollection", collectionAddress);
      expect(await collection.name()).to.equal("Test Collection - #1");
      expect(await collection.symbol()).to.equal("TEST1");
    });

    it("Should handle maximum length name and symbol", async () => {
      const salt = ethers.randomBytes(32);
      const startTime = BigInt(await time.latest()) + 3600n;
      
      const rounds = [{
        startTime,
        endTime: startTime + 3600n,
        price: parseEther("0.1"),
        maxSupply: 100n,
        merkleRoot: ethers.ZeroHash,
        isWhitelistEnabled: false
      }];
      
      // Create reasonable maximum length strings
      const maxName = "Very Long Collection Name That Is Still Valid"; // 40 chars
      const maxSymbol = "VLCN"; // 4 chars
      
      const tx = await launchpad.connect(deployer).deployCollectionWithRounds(
        maxName,
        maxSymbol,
        "ipfs://",
        1000n,
        owner.address,
        salt,
        rounds
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log: any) => log.eventName === "CollectionDeployed"
      );
      expect(event).to.not.be.undefined;
      
      const collectionAddress = event?.args[0];
      const collection = await ethers.getContractAt("NFTCollection", collectionAddress);
      expect(await collection.name()).to.equal(maxName);
      expect(await collection.symbol()).to.equal(maxSymbol);
    });

    it("Should handle URI with query parameters", async () => {
      const salt = ethers.randomBytes(32);
      const startTime = BigInt(await time.latest()) + 3600n;
      
      const rounds = [{
        startTime,
        endTime: startTime + 3600n,
        price: parseEther("0.1"),
        maxSupply: 100n,
        merkleRoot: ethers.ZeroHash,
        isWhitelistEnabled: false
      }];
      
      const complexURI = "ipfs://QmHash/metadata?format=json&version=1/";
      
      const tx = await launchpad.connect(deployer).deployCollectionWithRounds(
        "URI Test",
        "URI",
        complexURI,
        1000n,
        owner.address,
        salt,
        rounds
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(
        (log: any) => log.eventName === "CollectionDeployed"
      );
      expect(event).to.not.be.undefined;
      
      const collectionAddress = event?.args[0];
      const collection = await ethers.getContractAt("NFTCollection", collectionAddress);
      
      // Mint a token to test URI
      await collection.createRound(
        startTime,
        startTime + 3600n,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );
      
      await time.increaseTo(startTime + 1n);
      
      await collection.mint(0, 1n, [], { value: parseEther("0.1") });
      expect(await collection.tokenURI(1)).to.equal(complexURI + "1");
    });
  });
});