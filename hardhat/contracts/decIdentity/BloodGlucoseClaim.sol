// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "fhevm/lib/TFHE.sol";
import "./MedicalID.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";

/**
 * @title BloodGlucoseClaim
 * @author Cristian Paris
 * @dev Contract for computing the encrypted average of blood glucose level across multiple users
 */
contract BloodGlucoseClaim is SepoliaZamaFHEVMConfig, Ownable2Step {
    /// @dev Error thrown when an invalid claim ID is provided
    error InvalidClaimId();
    /// @dev Error thrown when an invalid contract address is provided
    error InvalidContractAddress();
    /// @dev Error thrown when caller is not authorized
    error NotAuthorized();
    /// @dev Error thrown when input list is empty
    error EmptyUserList();

    /// @dev Counter for tracking the latest claim ID
    uint64 public lastClaimID = 0;
    /// @dev Mapping of claim IDs to encrypted numerical results for blood glucose claims
    mapping(uint64 => euint64) private bloodGlucoseClaims;

    /// @dev Instance of IdMapping contract for user ID management
    IdMapping private idMapping;
    /// @dev Instance of MedicalID contract for identity access
    MedicalID private medicalIDContract;

    /// @dev Emitted when a blood glucose claim
    /// @param claimId The ID of the generated claim
    event BloodGlucoseClaimEvent(uint64 claimId);

    /**
     * @dev Constructor to initialize the contract with required contract addresses
     * @param _idMappingAddress Address of the IdMapping contract
     * @param _medicalIDAddress  Address of the MedicalID contract
     * @custom:throws InvalidContractAddress if any address is zero
     */
    constructor(address _idMappingAddress, address _medicalIDAddress) Ownable(msg.sender) {
        if (_idMappingAddress == address(0) || _medicalIDAddress == address(0)) {
            revert InvalidContractAddress();
        }
        idMapping = IdMapping(_idMappingAddress);
        medicalIDContract = MedicalID(_medicalIDAddress);
    }

    /**
     * @notice Computes the average bloodGlucose level (encrypted) for a list of users
     * @dev   Fetches each user's encrypted bloodGlucose via MedicalID.getIdentity(...)
     *        Homomorphically adds them, then divides by the list length.
     *        Returns the resulting ciphertext.
     * @param userIds Array of user IDs whose bloodGlucose levels to average
     * @custom:throws NotAuthorized   if called by anyone other than the MedicalID contract
     * @custom:throws EmptyUserList   if the input array is empty
     * @custom:emits AdultClaimGenerated when claim is generated
     */
    function generateBloodGlucoseClaim(uint64[] memory userIds, address authAddress) public {
        // Only the MedicalID contract is permitted to call this method
        if (msg.sender != address(medicalIDContract)) revert NotAuthorized();

        uint64 len = uint64(userIds.length);
        if (len == 0) revert EmptyUserList();

        euint64 sum = TFHE.asEuint64(0);

        for (uint256 i = 0; i < len; i++) {
            (, euint16 bg, , , ) = medicalIDContract.getIdentity(userIds[i]);

            sum = TFHE.add(sum, bg);
        }

        euint64 average = TFHE.div(sum, len);

        lastClaimID++;

        TFHE.allowThis(average);
        TFHE.allow(average, authAddress);

        bloodGlucoseClaims[lastClaimID] = average;

        emit BloodGlucoseClaimEvent(lastClaimID);
    }

    function getBloodGlucoseClaim(uint64 claimId) public view returns (euint64) {
        if (claimId == 0 || claimId > lastClaimID) revert InvalidClaimId();
        return bloodGlucoseClaims[claimId];
    }
}
