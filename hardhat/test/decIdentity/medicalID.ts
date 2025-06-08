import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { toBufferBE } from "bigint-buffer";
import { expect } from "chai";
import type { FhevmInstance } from "fhevmjs";
import { ethers } from "hardhat";
import { performance } from "perf_hooks";

import type { BloodGlucoseClaim, IdMapping, MedicalID } from "../../types";
import { createInstance } from "../instance";
import { reencryptEbytes64, reencryptEuint64 } from "../reencrypt";
import { getSigners, initSigners } from "../signers";
import { bigIntToBytes64 } from "../utils";
import { deployBloodGlucoseClaimFixture } from "./fixture/BloodGlucoseClaim.fixture";


async function send<T extends ethers.ContractTransactionResponse>(
  txPromise: Promise<T>,
  label: string
): Promise<ethers.ContractTransactionReceipt> {
  const t0 = performance.now();
  const tx = await txPromise;
  const rcpt = await tx.wait();
  const t1 = performance.now();

  const minedBlock = await ethers.provider.getBlock(rcpt.blockNumber);
  const prevBlock = await ethers.provider.getBlock(rcpt.blockNumber - 1);

  console.log(
    `${label.padEnd(32)}| gasUsed ${rcpt.gasUsed} | ` +
    `wall ${((t1 - t0) / 1_000).toFixed(2)} s | ` +
    `blockΔ ${(minedBlock.timestamp - prevBlock.timestamp)} s`
  );

  expect(rcpt.gasUsed).to.be.gt(0n);
  return rcpt;
}

export const bigIntToBytes256 = (v: bigint) =>
  new Uint8Array(toBufferBE(v, 256));

describe("MedicalID (with size/gas/time checks)", function () {
  let medicalID: MedicalID;
  let bloodGlucoseClaim: BloodGlucoseClaim;
  let idMapping: IdMapping;

  before(async function () {
    await initSigners();
    this.signers = await getSigners();
  });

  beforeEach(async function () {
    const d = await deployBloodGlucoseClaimFixture();
    bloodGlucoseClaim = d.bloodGlucoseClaim;
    medicalID = d.medicalID;
    idMapping = d.idMapping;

    this.instances = await createInstance();
  });

  async function registerIdentity(
    userId: bigint,
    instance: FhevmInstance,
    medicalAddr: string,
    signer: HardhatEthersSigner,
    bloodGlucose: bigint = 8n,
    firstname = bigIntToBytes64(8n),
    lastname = bigIntToBytes64(8n),
    birthdate = 946681200n
  ) {
    const input = instance.createEncryptedInput(medicalAddr, signer.address);

    const tEnc0 = performance.now();
    const enc = await input
      .add16(bloodGlucose)
      .addBytes64(firstname)
      .addBytes64(lastname)
      .add32(birthdate)
      .encrypt();
    const tEnc1 = performance.now();
    console.log(
      `encrypt() for ${signer.address.slice(0, 6)}… took ${((tEnc1 - tEnc0) / 1_000).toFixed(2)} s`
    );

    await send(
      medicalID.connect(signer).registerIdentity(
        userId,
        enc.handles[0],
        enc.handles[1],
        enc.handles[2],
        enc.handles[3],
        enc.inputProof
      ),
      `registerIdentity(${signer.address.slice(0, 6)}…)`
    );
  }

  // it("registers an identity successfully", async function () {
  //   await (await idMapping.connect(this.signers.alice).generateId()).wait();
  //   const userId = await idMapping.getId(this.signers.alice.address);

  //   await registerIdentity(
  //     userId,
  //     this.instances,
  //     await medicalID.getAddress(),
  //     this.signers.alice
  //   );

  //   expect(await medicalID.registered(userId)).to.be.true;
  // });

  // it("prevents duplicate registration", async function () {
  //   await (await idMapping.connect(this.signers.alice).generateId()).wait();
  //   const userId = await idMapping.getId(this.signers.alice.address);

  //   await registerIdentity(userId, this.instances, await medicalID.getAddress(), this.signers.alice);

  //   await expect(
  //     registerIdentity(userId, this.instances, await medicalID.getAddress(), this.signers.alice)
  //   ).to.be.revertedWithCustomError(medicalID, "AlreadyRegistered");
  // });

  // it("retrieves the registered identity", async function () {
  //   await (await idMapping.connect(this.signers.alice).generateId()).wait();
  //   const userId = await idMapping.getId(this.signers.alice.address);

  //   await registerIdentity(
  //     userId,
  //     this.instances,
  //     await medicalID.getAddress(),
  //     this.signers.alice
  //   );

  //   const firstnameHandleAlice = await medicalID.getMyIdentityFirstname(userId);

  //   const reencryptedFirstname = await reencryptEbytes64(
  //     this.signers.alice,
  //     this.instances,
  //     firstnameHandleAlice,
  //     await medicalID.getAddress()
  //   );

  //   expect(reencryptedFirstname).to.equal(8);
  // });

  it("generates an adult claim (gas/size/time instrumentation)", async function () {
    /* small helper local to this test ───────────────────────────────*/
    const t = async <T>(label: string, f: () => Promise<T>): Promise<T> => {
      const t0 = performance.now();
      const out = await f();
      const t1 = performance.now();
      console.log(`${label.padEnd(24)}| view ${(t1 - t0).toFixed(2)} ms`);
      return out;
    };

    /* ids for three users ───────────────────────────────────────────*/
    await send(
      idMapping.connect(this.signers.alice).generateId(),
      "generateId(alice)"
    );
    const id1 = await t("getId(alice)", () =>
      idMapping.getId(this.signers.alice.address)
    );

    await send(
      idMapping.connect(this.signers.bob).generateId(),
      "generateId(bob)"
    );
    const id2 = await t("getId(bob)", () =>
      idMapping.getId(this.signers.bob.address)
    );

    // await send(
    //   idMapping.connect(this.signers.carol).generateId(),
    //   "generateId(carol)"
    // );
    // const id3 = await t("getId(carol)", () =>
    //   idMapping.getId(this.signers.carol.address)
    // );

    /* register identities ───────────────────────────────────────────*/
    await registerIdentity(id1, this.instances, await medicalID.getAddress(), this.signers.alice, 723n);
    await registerIdentity(id2, this.instances, await medicalID.getAddress(), this.signers.alice, 145n);
    // await registerIdentity(id3, this.instances, await medicalID.getAddress(), this.signers.alice, 132n);

    /* whitelist claim-runner (dave) ────────────────────────────────*/
    await send(
      medicalID.connect(this.signers.alice).addToWhitelist(this.signers.dave.address),
      "addToWhitelist(dave)"
    );

    /* generate the claim ────────────────────────────────────────────*/
    const claimRcpt = await send(
      medicalID.connect(this.signers.dave).generateClaim(
        await bloodGlucoseClaim.getAddress(),
        "generateBloodGlucoseClaim(uint64[],address)",
        [id1, id2],
        ["id", "birthdate", "bloodGlucose"]
      ),
      "generateClaim"
    );

    await expect(claimRcpt).to.emit(bloodGlucoseClaim, "BloodGlucoseClaimEvent");

    /* view-functions timing & result check ─────────────────────────*/
    const claimId = await t("lastClaimID()", () => bloodGlucoseClaim.lastClaimID());
    const encAvg = await t("getBloodGlucoseClaim()", () =>
      bloodGlucoseClaim.getBloodGlucoseClaim(claimId)
    );

    const plainAvg = await t("reencryptEuint64()", async () =>
      reencryptEuint64(
        this.signers.dave,
        this.instances,
        encAvg,
        await bloodGlucoseClaim.getAddress()
      )
    );

    expect(plainAvg).to.equal(434n);
  });
});
