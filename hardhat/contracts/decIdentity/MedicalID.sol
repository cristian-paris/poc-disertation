// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "fhevm/lib/TFHE.sol";
import "./IdMapping.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";

/**
 * @title MedicalID
 * @author Cristian Paris
 * @notice Manages encrypted medical data and verification claims
 * @dev Implements role-based access control for registrars and admins to manage identity registration
 */
contract MedicalID is SepoliaZamaFHEVMConfig, AccessControl {
    /// @dev Constants
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// @dev Custom errors
    /// @notice Thrown when attempting to register an identity for a user who already has one
    error AlreadyRegistered();
    /// @notice Thrown when attempting to access identity data for a user who doesn't have one registered
    error IdentityNotRegistered();
    /// @notice Thrown when sender doesn't have permission to access the encrypted data
    error AccessNotPermitted();
    /// @notice Thrown when claim generation fails, includes failure data
    /// @param data The error data returned from the failed claim generation
    error ClaimGenerationFailed(bytes data);
    /// @notice Thrown when no field is provided or an invalid field is requested
    error InvalidField();

    /**
     * @dev Structure to hold encrypted identity data
     * @param id Encrypted unique identifier for the identity record
     * @param bloodGlucose Encrypted blood glucose level
     * @param firstname Encrypted legal first name from medical ID
     * @param lastname Encrypted legal last name from medical ID
     * @param birthdate Encrypted date of birth in unix timestamp format
     */
    struct Identity {
        euint64 id; /// @dev Encrypted unique ID
        euint16 bloodGlucose; /// @dev Encrypted blood glucose level
        ebytes64 firstname; /// @dev Encrypted first name
        ebytes64 lastname; /// @dev Encrypted last name
        euint32 birthdate; /// @dev Encrypted birthdate for age verification
    }

    /// @dev Instance of IdMapping contract
    IdMapping private idMapping;

    /// @dev Mapping to store identities by user ID
    mapping(uint64 => Identity) private citizenIdentities;
    /// @dev Mapping to track registered identities
    mapping(uint256 => bool) public registered;

    /// @dev Event emitted when an identity is registered
    event IdentityRegistered(address indexed user);

    /**
     * @notice Initializes the medical identity management system
     * @dev Sets up FHEVM config and grants admin/registrar roles to deployer
     * @param _idMappingAddress Address of the IdMapping contract for user ID management
     */
    constructor(address _idMappingAddress) {
        idMapping = IdMapping(_idMappingAddress);
        _grantRole(OWNER_ROLE, msg.sender); /// @dev Admin role for contract owner
        _grantRole(REGISTRAR_ROLE, msg.sender); /// @dev Registrar role for contract owner
    }

    /**
     * @notice Grants registrar privileges to a new address
     * @dev Only callable by admin role
     * @param registrar Address to be granted registrar permissions
     */
    function addRegistrar(address registrar) external onlyRole(OWNER_ROLE) {
        _grantRole(REGISTRAR_ROLE, registrar);
    }

    /**
     * @notice Revokes registrar privileges from an address
     * @dev Only callable by admin role
     * @param registrar Address to have registrar permissions revoked
     */
    function removeRegistrar(address registrar) external onlyRole(OWNER_ROLE) {
        _revokeRole(REGISTRAR_ROLE, registrar);
    }

    /**
     * @notice Creates a new encrypted identity record
     * @dev Only admin role can register new identities. All data is stored in encrypted form
     * @param userId Unique identifier for the user from IdMapping contract
     * @param bloodGlucose Encrypted blood glucose level data with proof
     * @param firstname Encrypted first name with proof
     * @param lastname Encrypted last name with proof
     * @param birthdate Encrypted birthdate with proof
     * @param inputProof Zero-knowledge proof validating the encrypted inputs
     * @return bool True if registration was successful
     * @custom:throws AlreadyRegistered if userId already has an identity registered
     */
    function registerIdentity(
        uint64 userId,
        einput bloodGlucose,
        einput firstname,
        einput lastname,
        einput birthdate,
        bytes calldata inputProof
    ) public virtual onlyRole(REGISTRAR_ROLE) returns (bool) {
        if (registered[userId]) revert AlreadyRegistered();

        /// @dev Generate a new encrypted unique ID
        euint64 newId = TFHE.randEuint64();

        /// @dev Store the encrypted identity data
        citizenIdentities[userId] = Identity({
            id: newId,
            bloodGlucose: TFHE.asEuint16(bloodGlucose, inputProof),
            firstname: TFHE.asEbytes64(firstname, inputProof),
            lastname: TFHE.asEbytes64(lastname, inputProof),
            birthdate: TFHE.asEuint32(birthdate, inputProof)
        });

        registered[userId] = true; /// @dev Mark the identity as registered

        /// @dev Get the address associated with the user ID
        address addressToBeAllowed = idMapping.getAddr(userId);

        /// @dev Allow the user to access their own data
        TFHE.allow(citizenIdentities[userId].id, addressToBeAllowed);
        TFHE.allow(citizenIdentities[userId].bloodGlucose, addressToBeAllowed);
        TFHE.allow(citizenIdentities[userId].firstname, addressToBeAllowed);
        TFHE.allow(citizenIdentities[userId].lastname, addressToBeAllowed);
        TFHE.allow(citizenIdentities[userId].birthdate, addressToBeAllowed);

        /// @dev Allow the contract to access the data
        TFHE.allowThis(citizenIdentities[userId].id);
        TFHE.allowThis(citizenIdentities[userId].bloodGlucose);
        TFHE.allowThis(citizenIdentities[userId].firstname);
        TFHE.allowThis(citizenIdentities[userId].lastname);
        TFHE.allowThis(citizenIdentities[userId].birthdate);

        emit IdentityRegistered(addressToBeAllowed); /// @dev Emit event for identity registration

        return true;
    }

    /**
     * @notice Retrieves the complete encrypted identity record for a user
     * @dev Returns all encrypted identity fields as a tuple
     * @param userId ID of the user whose identity to retrieve
     * @return Tuple containing (id, bloodGlucose, firstname, lastname, birthdate)
     * @custom:throws IdentityNotRegistered if no identity exists for userId
     */
    function getIdentity(uint64 userId) public view virtual returns (euint64, euint16, ebytes64, ebytes64, euint32) {
        if (!registered[userId]) revert IdentityNotRegistered();
        return (
            citizenIdentities[userId].id,
            citizenIdentities[userId].bloodGlucose,
            citizenIdentities[userId].firstname,
            citizenIdentities[userId].lastname,
            citizenIdentities[userId].birthdate
        );
    }

    /**
     * @notice Retrieves only the encrypted birthdate for a user
     * @dev Useful for age verification claims
     * @param userId ID of the user whose birthdate to retrieve
     * @return Encrypted birthdate as euint32
     * @custom:throws IdentityNotRegistered if no identity exists for userId
     */
    function getBirthdate(uint64 userId) public view virtual returns (euint32) {
        if (!registered[userId]) revert IdentityNotRegistered();
        return citizenIdentities[userId].birthdate;
    }

    /**
     * @notice Retrieves only the encrypted first name for a user
     * @dev Useful for identity verification claims
     * @param userId ID of the user whose first name to retrieve
     * @return Encrypted first name as ebytes64
     * @custom:throws IdentityNotRegistered if no identity exists for userId
     */
    function getMyIdentityFirstname(uint64 userId) public view virtual returns (ebytes64) {
        if (!registered[userId]) revert IdentityNotRegistered();
        return citizenIdentities[userId].firstname;
    }

    /**
     * @notice Retrieves only the encrypted last name for a user
     * @dev Useful for identity verification claims
     * @param userId ID of the user whose last name to retrieve
     * @return Encrypted last name as ebytes64
     * @custom:throws IdentityNotRegistered if no identity exists for userId
     */
    function getMyIdentityLastname(uint64 userId) public view virtual returns (ebytes64) {
        if (!registered[userId]) revert IdentityNotRegistered();
        return citizenIdentities[userId].lastname;
    }

    /**
     * @notice Retrieves only the encrypted glucose level for a user
     * @dev Useful for identity verification claims
     * @param userId ID of the user whose glucose level to retrieve
     * @return Encrypted glucose level as euint16
     * @custom:throws IdentityNotRegistered if no identity exists for userId
     */
    function getMyIdentityGlucoseLevel(uint64 userId) public view virtual returns (euint16) {
        if (!registered[userId]) revert IdentityNotRegistered();
        return citizenIdentities[userId].bloodGlucose;
    }

    /**
     * @notice Generates a verification claim using multiple users' identity data
     * @dev Temporarily grants claim contract access to required encrypted data
     * @param claimAddress Contract address that will process the claim
     * @param claimFn Function signature in the claim contract to call (should accept a uint64[] argument)
     * @param userIds   List of user IDs whose fields should be granted access
     * @param fields    List of field names to grant (e.g., ["id","birthdate","firstname",…])
     * @custom:throws IdentityNotRegistered if any userId has no identity
     * @custom:throws InvalidField if any field name is empty or unknown
     * @custom:throws ClaimGenerationFailed if the external claim call fails
     */
    function generateClaim(
        address claimAddress,
        string memory claimFn,
        uint64[] memory userIds,
        string[] memory fields
    ) public {
        ebytes128 test = TFHE.randEbytes128();
        TFHE.isInitialized(test);

        // For each requested userId, grant transient access to the requested fields
        // WARNING: more ids and fields equal to more gas, which would drive the costs up
        for (uint64 ui = 0; ui < userIds.length; ui++) {
            uint64 uid = userIds[ui];
            if (!registered[uid]) revert IdentityNotRegistered();

            for (uint64 i = 0; i < fields.length; i++) {
                if (bytes(fields[i]).length == 0) revert InvalidField();
                bytes32 h = keccak256(bytes(fields[i]));

                if (h == keccak256(bytes("id"))) {
                    TFHE.allowTransient(citizenIdentities[uid].id, claimAddress);
                } else if (h == keccak256(bytes("birthdate"))) {
                    TFHE.allowTransient(citizenIdentities[uid].birthdate, claimAddress);
                } else if (h == keccak256(bytes("bloodGlucose"))) {
                    TFHE.allowTransient(citizenIdentities[uid].bloodGlucose, claimAddress);
                } else if (h == keccak256(bytes("firstname"))) {
                    TFHE.allowTransient(citizenIdentities[uid].firstname, claimAddress);
                } else if (h == keccak256(bytes("lastname"))) {
                    TFHE.allowTransient(citizenIdentities[uid].lastname, claimAddress);
                } else {
                    revert InvalidField();
                }
            }
        }

        // Call the external claim contract. The claim function should accept the array of user IDs.
        (bool success, bytes memory data) = claimAddress.call(abi.encodeWithSignature(claimFn, userIds, msg.sender));
        if (!success) revert ClaimGenerationFailed(data);
    }
}
