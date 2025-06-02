import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { toBufferBE } from "bigint-buffer";
import { expect } from "chai";
import type { FhevmInstance } from "fhevmjs";

import type { BloodGlucoseClaim, IdMapping, MedicalID } from "../../types";
import { createInstance } from "../instance";
import { reencryptEbool, reencryptEbytes64, reencryptEuint256 } from "../reencrypt";
import { getSigners, initSigners } from "../signers";
import { bigIntToBytes64 } from "../utils";
import { deployBloodGlucoseClaimFixture } from "./fixture/BloodGlucoseClaim.fixture";

// Helper function to convert bigint to bytes
export const bigIntToBytes256 = (value: bigint) => {
  return new Uint8Array(toBufferBE(value, 256));
};

describe("MedicalID", function () {
  let medicalID: MedicalID;
  let bloodGlucoseClaim: BloodGlucoseClaim;
  let idMapping: IdMapping;

  // Initialize signers before running tests
  before(async function () {
    await initSigners();
    this.signers = await getSigners();
  });

  // Deploy fresh contract instances before each test
  beforeEach(async function () {
    const deployment = await deployBloodGlucoseClaimFixture();
    bloodGlucoseClaim = deployment.bloodGlucoseClaim;
    medicalID = deployment.medicalID;
    idMapping = deployment.idMapping;

    this.bloodGlucoseClaimAddress = await bloodGlucoseClaim.getAddress();
    this.medicalIDAddress = await medicalID.getAddress();
    this.idMappingAddress = await idMapping.getAddress();

    this.instances = await createInstance();
  });

  // Helper function to register identity
  async function registerIdentity(
    userId: bigint,
    instance: FhevmInstance,
    medicalAddress: string,
    signer: HardhatEthersSigner,
    bloodGlucose = 8n,
    firstname = bigIntToBytes64(8n),
    lastname = bigIntToBytes64(8n),
    birthdate = 946681200n, // Sat Jan 01 2000 - 24 years old
  ) {
    const input = instance.createEncryptedInput(medicalAddress, signer.address);
    const encryptedData = await input
      .add256(bloodGlucose)
      .addBytes64(firstname)
      .addBytes64(lastname)
      .add64(birthdate)
      .encrypt();

    await medicalID
      .connect(signer)
      .registerIdentity(
        userId,
        encryptedData.handles[0],
        encryptedData.handles[1],
        encryptedData.handles[2],
        encryptedData.handles[3],
        encryptedData.inputProof,
      );
  }

  // Test case: Register an identity successfully
  it("should register an identity successfully", async function () {
    await idMapping.connect(this.signers.alice).generateId();
    const userId = await idMapping.getId(this.signers.alice);

    await registerIdentity(userId, this.instances, this.medicalIDAddress, this.signers.alice);

    expect(await medicalID.registered(this.signers.alice.address));
  });

  // Test case: Prevent duplicate registration for the same user
  it("should prevent duplicate registration for the same user", async function () {
    await idMapping.connect(this.signers.alice).generateId();
    const userId = await idMapping.getId(this.signers.alice);

    await registerIdentity(userId, this.instances, this.medicalIDAddress, this.signers.alice);

    await expect(
      registerIdentity(userId, this.instances, this.medicalIDAddress, this.signers.alice),
    ).to.be.revertedWithCustomError(medicalID, "AlreadyRegistered");
  });

  // Test case: Retrieve the registered identity
  it("should retrieve the registered identity", async function () {
    await idMapping.connect(this.signers.alice).generateId();
    const userId = await idMapping.getId(this.signers.alice);

    await registerIdentity(userId, this.instances, this.medicalIDAddress, this.signers.alice);

    const firstnameHandleAlice = await medicalID.getMyIdentityFirstname(userId);

    const reencryptedFirstname = await reencryptEbytes64(
      this.signers.alice,
      this.instances,
      firstnameHandleAlice,
      this.medicalIDAddress,
    );

    expect(reencryptedFirstname).to.equal(8);
  });

  // Test case: Generate a blood glucose claim
  it("should generate an adult claim", async function () {
    await idMapping.connect(this.signers.alice).generateId();
    const userId1 = await idMapping.getId(this.signers.alice);

    await idMapping.connect(this.signers.bob).generateId();
    const userId2 = await idMapping.getId(this.signers.bob);

    // Only Alice (owner and registrar) can add new identities
    await registerIdentity(userId1, this.instances, this.medicalIDAddress, this.signers.alice, 20n);
    await registerIdentity(userId2, this.instances, this.medicalIDAddress, this.signers.alice, 10n);

    const tx = await medicalID
      .connect(this.signers.carol)
      .generateClaim(this.bloodGlucoseClaimAddress, "generateBloodGlucoseClaim(uint256[],address)",[userId1, userId2], ["id", "birthdate", "bloodGlucose"]);

    await expect(tx).to.emit(bloodGlucoseClaim, "BloodGlucoseClaimEvent");

    const latestClaimUserId = await bloodGlucoseClaim.lastClaimID();

    console.log("Adults claim id is: ", latestClaimUserId);

    const adultsClaim = await bloodGlucoseClaim.getBloodGlucoseClaim(latestClaimUserId);


    console.log("Adults claim is: ", adultsClaim);

    const reencrypted = await reencryptEuint256(
      this.signers.carol,
      this.instances,
      adultsClaim,
      this.bloodGlucoseClaimAddress,
    );

    expect(reencrypted).to.equal(15n);
  });
});
