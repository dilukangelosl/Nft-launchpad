import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { NFTCollection } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ZeroAddress, parseEther, keccak256, solidityPackedKeccak256, id } from "ethers";

describe("NFTCollection", () => {
  let collection: NFTCollection;
  let owner: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  const name = "TestNFT";
  const symbol = "TNFT";
  const baseURI = "ipfs://QmTest/";
  const maxSupply = 1000n;

  beforeEach(async () => {
    [owner, admin, user1, user2] = await ethers.getSigners();

    const CollectionFactory = await ethers.getContractFactory("NFTCollection");
    collection = await CollectionFactory.deploy(
      name,
      symbol,
      baseURI,
      maxSupply,
      owner.address
    );
    await collection.waitForDeployment();
  });

  describe("Base Functionality", () => {
    it("Should return correct token URI", async () => {
      const startTime = await time.latest() + 3600;
      await collection.createRound(
        startTime,
        startTime + 7200,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );

      await time.increaseTo(startTime + 1);
      
      await collection.connect(user1).mint(0, 1n, [], {
        value: parseEther("0.1")
      });

      expect(await collection.tokenURI(1)).to.equal(baseURI + "1");
    });

    it("Should support ERC721 interface", async () => {
      expect(await collection.supportsInterface("0x80ac58cd")).to.be.true; // ERC721
      expect(await collection.supportsInterface("0x5b5e139f")).to.be.true; // ERC721Metadata
      expect(await collection.supportsInterface("0x7965db0b")).to.be.true; // AccessControl
    });
  });


  describe("Whitelist Minting", () => {
    let merkleRoot: string;
    let proof: string[];

    beforeEach(async () => {
      // Create leaves for merkle tree
      const whitelistAddresses = [user1.address];

      // Calculate leaf for user1 exactly as the contract does
      const leaf = solidityPackedKeccak256(["address"], [user1.address]);

      // For this simple case with one address, the root is the leaf
      merkleRoot = leaf;
      proof = []; // Empty proof since we only have one leaf

      const startTime = (await time.latest()) + 3600;
      const endTime = startTime + 7200;

      await collection.createRound(
        startTime,
        endTime,
        parseEther("0.1"),
        100n,
        merkleRoot,
        true // Enable whitelist
      );

      await time.increaseTo(startTime + 1);
    });

    it("Should allow whitelisted address to mint", async () => {
      await expect(
        collection.connect(user1).mint(0, 1n, proof, {
          value: parseEther("0.1"),
        })
      ).to.emit(collection, "TokenMinted");

      expect(await collection.balanceOf(user1.address)).to.equal(1n);
    });

    it("Should reject non-whitelisted address", async () => {
      await expect(
        collection.connect(user2).mint(0, 1n, proof, {
          value: parseEther("0.1"),
        })
      ).to.be.revertedWith("Invalid proof");
    });

    it("Should reject invalid merkle proof", async () => {
      const invalidProof = [ethers.ZeroHash]; // Some invalid proof

      await expect(
        collection.connect(user1).mint(0, 1n, invalidProof, {
          value: parseEther("0.1"),
        })
      ).to.be.revertedWith("Invalid proof");
    });

    it("Should handle multiple whitelist addresses", async () => {
      // Create new round with multiple addresses
      const leaf1 = solidityPackedKeccak256(["address"], [user1.address]);
      const leaf2 = solidityPackedKeccak256(["address"], [user2.address]);

      // Create merkle root with two leaves
      const merkleRoot2 = solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [leaf1, leaf2].sort() // Sort to ensure deterministic order
      );

      const startTime = (await time.latest()) + 3600;
      const endTime = startTime + 7200;

      await collection.createRound(
        startTime,
        endTime,
        parseEther("0.1"),
        100n,
        merkleRoot2,
        true
      );

      await time.increaseTo(startTime + 1);

      // Generate proof for user1
      const proof1 = [leaf2]; // Proof for user1 is leaf2

      // Both users should be able to mint
      await expect(
        collection.connect(user1).mint(1, 1n, proof1, {
          value: parseEther("0.1"),
        })
      ).to.emit(collection, "TokenMinted");

      const proof2 = [leaf1]; // Proof for user2 is leaf1
      await expect(
        collection.connect(user2).mint(1, 1n, proof2, {
          value: parseEther("0.1"),
        })
      ).to.emit(collection, "TokenMinted");
    });
  });


  describe("Role Management", () => {
    it("Should allow admin to grant and revoke roles", async () => {
      const minterRole = await collection.MINTER_ROLE();
      
      await collection.grantRole(minterRole, user1.address);
      expect(await collection.hasRole(minterRole, user1.address)).to.be.true;
      
      await collection.revokeRole(minterRole, user1.address);
      expect(await collection.hasRole(minterRole, user1.address)).to.be.false;
    });

    it("Should allow role renouncement", async () => {
      const minterRole = await collection.MINTER_ROLE();
      await collection.grantRole(minterRole, user1.address);
      await collection.connect(user1).renounceRole(minterRole, user1.address);
      expect(await collection.hasRole(minterRole, user1.address)).to.be.false;
    });
  });

  describe("Round Management", () => {
    it("Should revert creating round with invalid times", async () => {
      const startTime = await time.latest() + 3600;
      await expect(
        collection.createRound(
          startTime,
          startTime - 1, // end before start
          parseEther("0.1"),
          100n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Invalid times");
    });

    it("Should revert creating round with zero maxSupply", async () => {
      const startTime = await time.latest() + 3600;
      await expect(
        collection.createRound(
          startTime,
          startTime + 3600,
          parseEther("0.1"),
          0n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Invalid supply");
    });

    it("Should track total rounds correctly", async () => {
      const startTime = await time.latest() + 3600;
      
      expect(await collection.totalRounds()).to.equal(0n);
      
      await collection.createRound(
        startTime,
        startTime + 3600,
        parseEther("0.1"),
        100n,
        ethers.ZeroHash,
        false
      );
      
      expect(await collection.totalRounds()).to.equal(1n);
    });

    it("Should not allow non-admin to create rounds", async () => {
      const startTime = await time.latest() + 3600;
      await expect(
        collection.connect(user1).createRound(
          startTime,
          startTime + 3600,
          parseEther("0.1"),
          100n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWithCustomError(collection, "AccessControlUnauthorizedAccount");
    });
  });



  describe("Supply Management", () => {
    beforeEach(async () => {
      const startTime = (await time.latest()) + 3600;
      const endTime = startTime + 7200; // 2 hours duration

      await collection.createRound(
        startTime,
        endTime,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );

      await time.increaseTo(startTime + 1);
    });

    it("Should track round supply correctly", async () => {
      await collection.connect(user1).mint(0, 5n, [], {
        value: parseEther("0.5"),
      });

      const round = await collection.mintRounds(0);
      expect(round.mintedSupply).to.equal(5n);
    });

    it("Should prevent minting beyond round supply", async () => {
      await collection.connect(user1).mint(0, 5n, [], {
        value: parseEther("0.5"),
      });

      await expect(
        collection.connect(user2).mint(0, 6n, [], {
          value: parseEther("0.6"),
        })
      ).to.be.revertedWith("Exceeds round supply");
    });

    it("Should prevent minting beyond max supply", async () => {
      const startTime = (await time.latest()) + 3600;
      const endTime = startTime + 7200; // 2 hours duration

      // Create first round and mint max tokens
      await collection.createRound(
        startTime,
        endTime,
        parseEther("0.1"),
        maxSupply,
        ethers.ZeroHash,
        false
      );

      await time.increaseTo(startTime + 1);

      // Mint up to maxSupply
      await collection.connect(user1).mint(1, maxSupply, [], {
        value: parseEther("0.1") * maxSupply,
      });

      // Create another round
      const secondStartTime = endTime + 3600;
      const secondEndTime = secondStartTime + 7200;

      await collection.createRound(
        secondStartTime,
        secondEndTime,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );

      await time.increaseTo(secondStartTime + 1);

      // Try to mint 1 more token
      await expect(
        collection.connect(user2).mint(2, 1n, [], {
          value: parseEther("0.1"),
        })
      ).to.be.revertedWith("Exceeds max supply");
    });
  });

  describe("Minting Mechanics", () => {
    beforeEach(async () => {
      const startTime = await time.latest() + 3600;
      await collection.createRound(
        startTime,
        startTime + 7200,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );
      await time.increaseTo(startTime + 1);
    });

    it("Should mint sequential token IDs", async () => {
      await collection.connect(user1).mint(0, 2n, [], {
        value: parseEther("0.2")
      });

      expect(await collection.ownerOf(1n)).to.equal(user1.address);
      expect(await collection.ownerOf(2n)).to.equal(user1.address);
    });

    it("Should revert when minting with insufficient payment", async () => {
      await expect(
        collection.connect(user1).mint(0, 1n, [], {
          value: parseEther("0.05") // Half the required price
        })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("Should handle maximum mint quantity in round", async () => {
      await collection.connect(user1).mint(0, 10n, [], {
        value: parseEther("1.0")
      });
      expect(await collection.balanceOf(user1.address)).to.equal(10n);
    });

    it("Should correctly update round minted supply", async () => {
      await collection.connect(user1).mint(0, 5n, [], {
        value: parseEther("0.5")
      });

      const round = await collection.mintRounds(0);
      expect(round.mintedSupply).to.equal(5n);
    });

    it("Should emit TokenMinted events", async () => {
      await expect(
        collection.connect(user1).mint(0, 2n, [], {
          value: parseEther("0.2")
        })
      ).to.emit(collection, "TokenMinted").withArgs(user1.address, 1n, 0n, parseEther("0.1"))
        .and.to.emit(collection, "TokenMinted").withArgs(user1.address, 2n, 0n, parseEther("0.1"));
    });

    it("Should not allow minting when round is inactive", async () => {
      await collection.setRoundActive(0, false);
      await expect(
        collection.connect(user1).mint(0, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.be.revertedWith("Round not active");
    });
  });

  describe("Round State Management", () => {
    it("Should allow updating round parameters", async () => {
      const startTime = await time.latest() + 3600;
      await collection.createRound(
        startTime,
        startTime + 3600,
        parseEther("0.1"),
        100n,
        ethers.ZeroHash,
        false
      );

      const newStartTime = startTime + 1800;
      const newEndTime = startTime + 5400;
      const newPrice = parseEther("0.2");
      const newMaxSupply = 200n;
      const newMerkleRoot = id("new root"); // Using id instead of manual keccak256

      await collection.updateRound(
        0,
        newStartTime,
        newEndTime,
        newPrice,
        newMaxSupply,
        newMerkleRoot,
        true
      );

      const round = await collection.mintRounds(0);
      expect(round.startTime).to.equal(newStartTime);
      expect(round.endTime).to.equal(newEndTime);
      expect(round.price).to.equal(newPrice);
      expect(round.maxSupply).to.equal(newMaxSupply);
      expect(round.merkleRoot).to.equal(newMerkleRoot);
      expect(round.isWhitelistEnabled).to.be.true;
    });

    it("Should revert updating non-existent round", async () => {
      const startTime = await time.latest() + 3600;
      await expect(
        collection.updateRound(
          0,
          startTime,
          startTime + 3600,
          parseEther("0.1"),
          100n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Invalid round");
    });

    it("Should revert updating inactive round", async () => {
      const startTime = await time.latest() + 3600;
      await collection.createRound(
        startTime,
        startTime + 3600,
        parseEther("0.1"),
        100n,
        ethers.ZeroHash,
        false
      );

      await collection.setRoundActive(0, false);

      await expect(
        collection.updateRound(
          0,
          startTime,
          startTime + 3600,
          parseEther("0.2"),
          100n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Round not active");
    });
  });

  describe("Withdrawal", () => {
    beforeEach(async () => {
      const startTime = await time.latest() + 3600;
      await collection.createRound(
        startTime,
        startTime + 7200,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );
      await time.increaseTo(startTime + 1);
    });

    it("Should allow admin to withdraw funds", async () => {
      await collection.connect(user1).mint(0, 5n, [], {
        value: parseEther("0.5")
      });

      const initialBalance = await ethers.provider.getBalance(owner.address);
      const tx = await collection.withdraw();
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const finalBalance = await ethers.provider.getBalance(owner.address);

      expect(finalBalance + gasCost - initialBalance).to.equal(parseEther("0.5"));
    });

    it("Should revert withdrawal with no balance", async () => {
      await expect(collection.withdraw()).to.be.revertedWith("No balance");
    });

    it("Should revert withdrawal from non-admin", async () => {
      await collection.connect(user1).mint(0, 1n, [], {
        value: parseEther("0.1")
      });

      await expect(
        collection.connect(user1).withdraw()
      ).to.be.revertedWithCustomError(collection, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Edge Cases and Error Handling", () => {
    beforeEach(async () => {
      const startTime = await time.latest() + 3600;
      await collection.createRound(
        startTime,
        startTime + 7200,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );
      await time.increaseTo(startTime + 1);
    });

    it("Should handle maximum token ID", async () => {
      await collection.connect(user1).mint(0, 10n, [], {
        value: parseEther("1.0")
      });

      // Try to mint one more
      await expect(
        collection.connect(user1).mint(0, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.be.revertedWith("Exceeds round supply");
    });

    it("Should fail when minting with no payment", async () => {
      await expect(
        collection.connect(user1).mint(0, 1n, [], {
          value: 0
        })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("Should fail when minting more than round supply", async () => {
      await expect(
        collection.connect(user1).mint(0, 11n, [], {
          value: parseEther("1.1")
        })
      ).to.be.revertedWith("Exceeds round supply");
    });

    it("Should handle concurrent minting from different users", async () => {
      await Promise.all([
        collection.connect(user1).mint(0, 3n, [], {
          value: parseEther("0.3")
        }),
        collection.connect(user2).mint(0, 3n, [], {
          value: parseEther("0.3")
        })
      ]);

      expect(await collection.balanceOf(user1.address)).to.equal(3n);
      expect(await collection.balanceOf(user2.address)).to.equal(3n);
    });

    it("Should fail when minting after round end", async () => {
      await time.increaseTo((await collection.mintRounds(0)).endTime + 1n);
      
      await expect(
        collection.connect(user1).mint(0, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.be.revertedWith("Round ended");
    });

    it("Should fail when minting before round start", async () => {
      // Create a new round in the future
      const startTime = await time.latest() + 7200;
      await collection.createRound(
        startTime,
        startTime + 3600,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );

      await expect(
        collection.connect(user1).mint(1, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.be.revertedWith("Round not started");
    });

    it("Should handle high price minting", async () => {
      // Create a round with high but reasonable price
      const startTime = await time.latest() + 3600;
      const highPrice = parseEther("100"); // 100 ETH
      
      await collection.createRound(
        startTime,
        startTime + 3600,
        highPrice,
        10n,
        ethers.ZeroHash,
        false
      );

      await time.increaseTo(startTime + 1);

      // Try to mint with insufficient payment
      await expect(
        collection.connect(user1).mint(1, 1n, [], {
          value: highPrice - parseEther("1")
        })
      ).to.be.revertedWith("Insufficient payment");

      // Mint with exact payment
      await expect(
        collection.connect(user1).mint(1, 1n, [], {
          value: highPrice
        })
      ).to.emit(collection, "TokenMinted");
    });

    it("Should handle price variations across rounds", async () => {
      // Create rounds with different prices
      const prices = [
        parseEther("0.1"),   // Round 0 (already created in beforeEach)
        parseEther("0.5"),   // Round 1
        parseEther("1.0"),   // Round 2
        parseEther("0.05")   // Round 3
      ];

      for(let i = 1; i < prices.length; i++) {
        const startTime = await time.latest() + 3600 * (i + 1);
        await collection.createRound(
          startTime,
          startTime + 3600,
          prices[i],
          10n,
          ethers.ZeroHash,
          false
        );
      }

      // Test minting in each round
      for(let i = 0; i < prices.length; i++) {
        if(i > 0) {
          const round = await collection.mintRounds(i);
          await time.increaseTo(round.startTime + 1n);
        }

        await expect(
          collection.connect(user1).mint(i, 1n, [], {
            value: prices[i]
          })
        ).to.emit(collection, "TokenMinted");

        // Verify exact payment required
        await expect(
          collection.connect(user1).mint(i, 1n, [], {
            value: prices[i] - 1n
          })
        ).to.be.revertedWith("Insufficient payment");
      }
    });

    it("Should handle bulk minting at price limits", async () => {
      const quantity = 5n;
      const price = parseEther("0.1");
      const totalPrice = price * quantity;

      // Test exact payment
      await expect(
        collection.connect(user1).mint(0, quantity, [], {
          value: totalPrice
        })
      ).to.emit(collection, "TokenMinted");

      // Test insufficient payment for bulk mint
      await expect(
        collection.connect(user1).mint(0, quantity, [], {
          value: totalPrice - 1n
        })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("Should handle round transitions precisely", async () => {
      const startTime = await time.latest() + 3600;
      const endTime = startTime + 3600;
      
      await collection.createRound(
        startTime,
        endTime,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );

      // Test exact start time
      await time.increaseTo(startTime);
      await expect(
        collection.connect(user1).mint(1, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.emit(collection, "TokenMinted");

      // Test exact end time
      await time.increaseTo(endTime);
      await expect(
        collection.connect(user1).mint(1, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.be.revertedWith("Round ended");
    });

    it("Should enforce round supply limits strictly", async () => {
      const supply = 5n;
      const startTime = await time.latest() + 3600;
      
      await collection.createRound(
        startTime,
        startTime + 3600,
        parseEther("0.1"),
        supply,
        ethers.ZeroHash,
        false
      );

      await time.increaseTo(startTime + 1);

      // Mint exactly supply amount
      await collection.connect(user1).mint(1, supply, [], {
        value: parseEther("0.1") * supply
      });

      // Try to mint one more
      await expect(
        collection.connect(user1).mint(1, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.be.revertedWith("Exceeds round supply");
    });

    it("Should validate round parameters strictly", async () => {
      const startTime = await time.latest() + 3600;
      
      // Test zero supply
      await expect(
        collection.createRound(
          startTime,
          startTime + 3600,
          parseEther("0.1"),
          0n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Invalid supply");

      // Test end time before start time
      await expect(
        collection.createRound(
          startTime,
          startTime - 1,
          parseEther("0.1"),
          10n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Invalid times");

      // Test end time equal to start time
      await expect(
        collection.createRound(
          startTime,
          startTime,
          parseEther("0.1"),
          10n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Invalid times");
    });

    it("Should validate round update parameters strictly", async () => {
      const startTime = await time.latest() + 3600;
      
      // Create initial round
      await collection.createRound(
        startTime,
        startTime + 3600,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );

      // Test updating with end time before start time
      await expect(
        collection.updateRound(
          0,
          startTime + 1800, // new start time
          startTime + 1700, // new end time (before start)
          parseEther("0.1"),
          10n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Invalid times");

      // Test updating non-existent round
      await expect(
        collection.updateRound(
          99, // non-existent round id
          startTime,
          startTime + 3600,
          parseEther("0.1"),
          10n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Invalid round");

      // Test updating with zero supply
      await expect(
        collection.updateRound(
          0,
          startTime,
          startTime + 3600,
          parseEther("0.1"),
          0n,
          ethers.ZeroHash,
          false
        )
      ).to.be.revertedWith("Invalid supply");
    });

    it("Should validate round active status updates", async () => {
      // Test setting status for non-existent round
      await expect(
        collection.setRoundActive(99, false)
      ).to.be.revertedWith("Invalid round");

      const startTime = await time.latest() + 3600;
      await collection.createRound(
        startTime,
        startTime + 3600,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );

      // Test deactivating and activating round
      await collection.setRoundActive(0, false);
      let round = await collection.mintRounds(0);
      expect(round.isActive).to.be.false;

      await collection.setRoundActive(0, true);
      round = await collection.mintRounds(0);
      expect(round.isActive).to.be.true;
    });

    it("Should validate round status effects on minting", async () => {
      const startTime = await time.latest() + 3600;
      await collection.createRound(
        startTime,
        startTime + 3600,
        parseEther("0.1"),
        10n,
        ethers.ZeroHash,
        false
      );

      await time.increaseTo(startTime + 1);

      // Test minting when round is active
      await expect(
        collection.connect(user1).mint(0, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.emit(collection, "TokenMinted");

      // Test minting when round is deactivated
      await collection.setRoundActive(0, false);
      await expect(
        collection.connect(user1).mint(0, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.be.revertedWith("Round not active");

      // Test minting when round is reactivated
      await collection.setRoundActive(0, true);
      await expect(
        collection.connect(user1).mint(0, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.emit(collection, "TokenMinted");
    });

    it("Should handle minting with exact payment", async () => {
      await expect(
        collection.connect(user1).mint(0, 1n, [], {
          value: parseEther("0.1")
        })
      ).to.emit(collection, "TokenMinted");
    });

    it("Should handle multiple round transitions", async () => {
      // Mint in first round
      await collection.connect(user1).mint(0, 1n, [], {
        value: parseEther("0.1")
      });

      // Create and mint in second round
      const startTime = await time.latest() + 3600;
      await collection.createRound(
        startTime,
        startTime + 3600,
        parseEther("0.2"),
        10n,
        ethers.ZeroHash,
        false
      );

      await time.increaseTo(startTime + 1);

      await expect(
        collection.connect(user1).mint(1, 1n, [], {
          value: parseEther("0.2")
        })
      ).to.emit(collection, "TokenMinted");
    });
});
});