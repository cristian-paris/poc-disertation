import { ethers } from "hardhat";

import type { IdMapping, MedicalID } from "../../../types";
import { getSigners } from "../../signers";

export async function deployMedicalIDFixture(idMapping: IdMapping): Promise<MedicalID> {
  const signers = await getSigners();
  const contractFactory = await ethers.getContractFactory("MedicalID");
  const contract = await contractFactory.connect(signers.alice).deploy(idMapping);
  await contract.waitForDeployment();
  return contract;
}
