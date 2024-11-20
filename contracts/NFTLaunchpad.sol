// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./NFTCollection.sol";

/**
 * @title RoundParams
 * @notice Struct to define parameters for creating minting rounds
 */
struct RoundParams {
    uint256 startTime;
    uint256 endTime;
    uint256 price;
    uint256 maxSupply;
    bytes32 merkleRoot;
    bool isWhitelistEnabled;
}

/**
 * @title NFTLaunchpad
 * @notice Factory contract for deploying NFT collections with CREATE2
 */
contract NFTLaunchpad is AccessControl {
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    event CollectionDeployed(
        address indexed collection,
        address indexed owner,
        string name,
        string symbol,
        uint256 maxSupply,
        uint256 roundCount
    );
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DEPLOYER_ROLE, msg.sender);
    }
    
    /**
     * @dev Deploys a new NFT collection using CREATE2 and initializes minting rounds
     */
    function deployCollectionWithRounds(
        string memory name,
        string memory symbol,
        string memory baseURI,
        uint256 maxSupply,
        address owner,
        bytes32 salt,
        RoundParams[] calldata rounds
    ) external onlyRole(DEPLOYER_ROLE) returns (address) {
        require(maxSupply > 0, "Invalid max supply");
        require(owner != address(0), "Invalid owner");
        require(rounds.length > 0, "No rounds specified");
        
        // Create deployment bytecode with correct constructor parameters
        bytes memory bytecode = abi.encodePacked(
            type(NFTCollection).creationCode,
            abi.encode(name, symbol, baseURI, maxSupply, address(this))
        );
        
        // Deploy using CREATE2
        address collection;
        assembly {
            collection := create2(0, add(bytecode, 32), mload(bytecode), salt)
            if iszero(extcodesize(collection)) {
                revert(0, 0)
            }
        }

        // Get NFT collection instance
        NFTCollection nft = NFTCollection(collection);
        
        // Grant roles to the owner
        nft.grantRole(nft.DEFAULT_ADMIN_ROLE(), owner);
        nft.grantRole(nft.ADMIN_ROLE(), owner);
        nft.grantRole(nft.MINTER_ROLE(), owner);
        
        // Create all rounds
        for(uint i = 0; i < rounds.length; i++) {
            RoundParams memory round = rounds[i];
            require(round.startTime < round.endTime, "Invalid round times");
            require(round.maxSupply > 0, "Invalid round supply");
            
            nft.createRound(
                round.startTime,
                round.endTime,
                round.price,
                round.maxSupply,
                round.merkleRoot,
                round.isWhitelistEnabled
            );
        }

        // Revoke launchpad's roles
        nft.renounceRole(nft.DEFAULT_ADMIN_ROLE(), address(this));
        nft.renounceRole(nft.ADMIN_ROLE(), address(this));
        nft.renounceRole(nft.MINTER_ROLE(), address(this));
        
        emit CollectionDeployed(
            collection,
            owner,
            name,
            symbol,
            maxSupply,
            rounds.length
        );
        
        return collection;
    }
    
    /**
     * @dev Computes the address where a contract will be deployed using CREATE2
     */
    function computeAddress(
        string memory name,
        string memory symbol,
        string memory baseURI,
        uint256 maxSupply,
        address owner,
        bytes32 salt
    ) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(
                    abi.encodePacked(
                        type(NFTCollection).creationCode,
                        abi.encode(name, symbol, baseURI, maxSupply, address(this))
                    )
                )
            )
        );
        return address(uint160(uint(hash)));
    }
}