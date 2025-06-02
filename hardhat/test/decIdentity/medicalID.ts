import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { toBufferBE } from "bigint-buffer";
import { expect } from "chai";
import type { FhevmInstance } from "fhevmjs";

import type { BloodGlucoseClaim, IdMapping, MedicalID } from "../../types";
import { createInstance } from "../instance";
import { reencryptEbytes64, reencryptEuint256, reencryptEuint64 } from "../reencrypt";
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
      .add16(bloodGlucose)
      .addBytes64(firstname)
      .addBytes64(lastname)
      .add32(birthdate)
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

    await idMapping.connect(this.signers.carol).generateId();
    const userId3 = await idMapping.getId(this.signers.carol);

    // Only Alice (owner and registrar) can add new identities
    await registerIdentity(userId1, this.instances, this.medicalIDAddress, this.signers.alice, 723n);
    await registerIdentity(userId2, this.instances, this.medicalIDAddress, this.signers.alice, 145n);
    await registerIdentity(userId3, this.instances, this.medicalIDAddress, this.signers.alice, 132n);

    // Grant dave the role of claim runner
    await medicalID.connect(this.signers.alice).addToWhitelist(this.signers.dave.address);

    // Dave issues a new claim
    const tx = await medicalID
      .connect(this.signers.dave)
      .generateClaim(this.bloodGlucoseClaimAddress, "generateBloodGlucoseClaim(uint64[],address)",[userId1, userId2, userId3], ["id", "birthdate", "bloodGlucose"]);

    await expect(tx).to.emit(bloodGlucoseClaim, "BloodGlucoseClaimEvent");

    const latestClaimUserId = await bloodGlucoseClaim.lastClaimID();
    const adultsClaim = await bloodGlucoseClaim.getBloodGlucoseClaim(latestClaimUserId);

    // Dave is the only one to have the rights to decrypt it
    const reencrypted = await reencryptEuint64(
      this.signers.dave,
      this.instances,
      adultsClaim,
      this.bloodGlucoseClaimAddress,
    );

    expect(reencrypted).to.equal(333n);
  });
});
