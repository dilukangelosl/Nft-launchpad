// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title MintRound
 * @notice Struct to define mint round parameters
 */
struct MintRound {
    uint256 startTime;
    uint256 endTime;
    uint256 price;
    uint256 maxSupply;
    uint256 mintedSupply;
    bytes32 merkleRoot;
    bool isWhitelistEnabled;
    bool isActive;
}

/**
 * @title NFTCollection
 * @notice Implementation of ERC721 with multiple mint rounds and role-based access
 */
contract NFTCollection is ERC721, AccessControl, ReentrancyGuard {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    string private baseURIValue;
    uint256 private _tokenIds;
    uint256 public maxSupply;

    // Round management
    mapping(uint256 => MintRound) public mintRounds;
    uint256 public currentRoundId;
    uint256 public totalRounds;

    // Mint tracking
    mapping(address => mapping(uint256 => uint256)) public userMints;

    event RoundCreated(
        uint256 indexed roundId,
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        uint256 roundMaxSupply,
        bool isWhitelistEnabled
    );

    event RoundUpdated(
        uint256 indexed roundId,
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        uint256 roundMaxSupply,
        bool isWhitelistEnabled
    );

    event TokenMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint256 indexed roundId,
        uint256 price
    );

    constructor(
        string memory name,
        string memory symbol,
        string memory initBaseURI,
        uint256 initialMaxSupply,
        address owner
    ) ERC721(name, symbol) {
        baseURIValue = initBaseURI;
        maxSupply = initialMaxSupply;

        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(ADMIN_ROLE, owner);
        _grantRole(MINTER_ROLE, owner);
    }

    /**
     * @dev Base URI for computing {tokenURI}
     */
    function _baseURI() internal view override returns (string memory) {
        return baseURIValue;
    }

    /**
     * @dev Updates the base URI for token metadata
     */
    function setBaseURI(
        string memory newBaseURI
    ) external onlyRole(ADMIN_ROLE) {
        baseURIValue = newBaseURI;
    }

    /**
     * @dev Creates a new mint round
     */
    function createRound(
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        uint256 roundMaxSupply,
        bytes32 merkleRoot,
        bool isWhitelistEnabled
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        require(startTime < endTime, "Invalid times");
        require(roundMaxSupply > 0, "Invalid supply");

        uint256 roundId = totalRounds++;

        mintRounds[roundId] = MintRound({
            startTime: startTime,
            endTime: endTime,
            price: price,
            maxSupply: roundMaxSupply,
            mintedSupply: 0,
            merkleRoot: merkleRoot,
            isWhitelistEnabled: isWhitelistEnabled,
            isActive: true
        });

        emit RoundCreated(
            roundId,
            startTime,
            endTime,
            price,
            roundMaxSupply,
            isWhitelistEnabled
        );

        return roundId;
    }

    /**
     * @dev Updates an existing mint round
     */
    function updateRound(
        uint256 roundId,
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        uint256 roundMaxSupply,
        bytes32 merkleRoot,
        bool isWhitelistEnabled
    ) external onlyRole(ADMIN_ROLE) {
        require(roundId < totalRounds, "Invalid round");
        require(startTime < endTime, "Invalid times");
        require(roundMaxSupply > 0, "Invalid supply"); // Added this line to match createRound validation

        MintRound storage round = mintRounds[roundId];
        require(round.isActive, "Round not active");

        round.startTime = startTime;
        round.endTime = endTime;
        round.price = price;
        round.maxSupply = roundMaxSupply;
        round.merkleRoot = merkleRoot;
        round.isWhitelistEnabled = isWhitelistEnabled;

        emit RoundUpdated(
            roundId,
            startTime,
            endTime,
            price,
            roundMaxSupply,
            isWhitelistEnabled
        );
    }

    function _verifyMerkleProof(
        bytes32[] memory proof,
        bytes32 root
    ) internal view returns (bool) {
        bytes32 computedHash = keccak256(abi.encodePacked(msg.sender));

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (computedHash < proofElement) {
                computedHash = keccak256(
                    abi.encodePacked(computedHash, proofElement)
                );
            } else {
                computedHash = keccak256(
                    abi.encodePacked(proofElement, computedHash)
                );
            }
        }

        return computedHash == root;
    }

    function setRoundActive(
        uint256 roundId,
        bool isActive
    ) external onlyRole(ADMIN_ROLE) {
        require(roundId < totalRounds, "Invalid round");
        mintRounds[roundId].isActive = isActive;
    }

    function mint(
        uint256 roundId,
        uint256 quantity,
        bytes32[] calldata merkleProof
    ) external payable nonReentrant {
        MintRound storage round = mintRounds[roundId];
        require(round.isActive, "Round not active");
        require(block.timestamp >= round.startTime, "Round not started");
        require(block.timestamp <= round.endTime, "Round ended");
        require(
            round.mintedSupply + quantity <= round.maxSupply,
            "Exceeds round supply"
        );
        require(_tokenIds + quantity <= maxSupply, "Exceeds max supply");
        require(msg.value >= round.price * quantity, "Insufficient payment");

        if (round.isWhitelistEnabled) {
            require(
                _verifyMerkleProof(merkleProof, round.merkleRoot),
                "Invalid proof"
            );
        }

        round.mintedSupply += quantity;

        for (uint256 i = 0; i < quantity; ) {
            _tokenIds++;
            _safeMint(msg.sender, _tokenIds);
            emit TokenMinted(msg.sender, _tokenIds, roundId, round.price);
            unchecked {
                ++i;
            }
        }
    }

    function withdraw() external onlyRole(ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");

        (bool success, ) = payable(msg.sender).call{value: balance}("");
        require(success, "Transfer failed");
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}