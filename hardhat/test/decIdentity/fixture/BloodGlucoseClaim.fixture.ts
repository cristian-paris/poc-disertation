import { ethers } from "hardhat";

import type { BloodGlucoseClaim, IdMapping, MedicalID } from "../../../types";
import { deployIdMappingFixture } from "./IdMapping.fixture";
import { deployMedicalIDFixture } from "./MedicalID.fixture";

export async function deployBloodGlucoseClaimFixture(): Promise<{
  bloodGlucoseClaim: BloodGlucoseClaim;
  medicalID: MedicalID;
  idMapping: IdMapping;
}> {
  const idMapping = await deployIdMappingFixture();
  const medicalID = await deployMedicalIDFixture(idMapping);
  const BloodGlucoseClaimFactory = await ethers.getContractFactory("BloodGlucoseClaim");
  const bloodGlucoseClaim = await BloodGlucoseClaimFactory.deploy(idMapping, medicalID);
  await bloodGlucoseClaim.waitForDeployment();
  return { bloodGlucoseClaim, medicalID, idMapping };
}
