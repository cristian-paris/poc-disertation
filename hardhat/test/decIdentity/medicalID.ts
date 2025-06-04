import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { toBufferBE } from "bigint-buffer";
import { expect } from "chai";
import type { FhevmInstance } from "fhevmjs";

import type { BloodGlucoseClaim, IdMapping, MedicalID } from "../../types";
import { createInstance } from "../instance";
import { reencryptEbytes64, reencryptEuint64 } from "../reencrypt";
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

    await (
      await medicalID
        .connect(signer)
        .registerIdentity(
          userId,
          encryptedData.handles[0],
          encryptedData.handles[1],
          encryptedData.handles[2],
          encryptedData.handles[3],
          encryptedData.inputProof
        )
    ).wait();
  }

  it("registers an identity successfully", async function () {
    await (await idMapping.connect(this.signers.alice).generateId()).wait();
    const userId = await idMapping.getId(this.signers.alice.address);

    await registerIdentity(
      userId,
      this.instances,
      await medicalID.getAddress(),
      this.signers.alice
    );

    expect(await medicalID.registered(userId)).to.be.true;
  });

  it("prevents duplicate registration", async function () {
    await (await idMapping.connect(this.signers.alice).generateId()).wait();
    const userId = await idMapping.getId(this.signers.alice.address);

    await registerIdentity(userId, this.instances, await medicalID.getAddress(), this.signers.alice);

    await expect(
      registerIdentity(userId, this.instances, await medicalID.getAddress(), this.signers.alice)
    ).to.be.revertedWithCustomError(medicalID, "AlreadyRegistered");
  });

  it("retrieves the registered identity", async function () {
    await (await idMapping.connect(this.signers.alice).generateId()).wait();
    const userId = await idMapping.getId(this.signers.alice.address);

    await registerIdentity(
      userId,
      this.instances,
      await medicalID.getAddress(),
      this.signers.alice
    );

    const firstnameHandleAlice = await medicalID.getMyIdentityFirstname(userId);

    const reencryptedFirstname = await reencryptEbytes64(
      this.signers.alice,
      this.instances,
      firstnameHandleAlice,
      await medicalID.getAddress()
    );

    expect(reencryptedFirstname).to.equal(8);
  });

  it("generates an adult claim", async function () {
    await (await idMapping.connect(this.signers.alice).generateId()).wait();
    const id1 = await idMapping.getId(this.signers.alice.address);

    await (await idMapping.connect(this.signers.bob).generateId()).wait();
    const id2 = await idMapping.getId(this.signers.bob.address);

    await (await idMapping.connect(this.signers.carol).generateId()).wait();
    const id3 = await idMapping.getId(this.signers.carol.address);

    await registerIdentity(id1, this.instances, await medicalID.getAddress(), this.signers.alice, 723n);
    await registerIdentity(id2, this.instances, await medicalID.getAddress(), this.signers.alice, 145n);
    await registerIdentity(id3, this.instances, await medicalID.getAddress(), this.signers.alice, 132n);

    await (await medicalID.connect(this.signers.alice)
      .addToWhitelist(this.signers.dave.address)).wait();

    const tx = await medicalID.connect(this.signers.dave).generateClaim(
      await bloodGlucoseClaim.getAddress(),
      "generateBloodGlucoseClaim(uint64[],address)",
      [id1, id2, id3],
      ["id", "birthdate", "bloodGlucose"]
    );

    await tx.wait();

    await expect(tx)
      .to.emit(bloodGlucoseClaim, "BloodGlucoseClaimEvent");

    await tx.wait();

    const claimId = await bloodGlucoseClaim.lastClaimID();
    const encAvg = await bloodGlucoseClaim.getBloodGlucoseClaim(claimId);

    const plainAvg = await reencryptEuint64(
      this.signers.dave,
      this.instances,
      encAvg,
      await bloodGlucoseClaim.getAddress()
    );

    expect(plainAvg).to.equal(333n);
  });
});
