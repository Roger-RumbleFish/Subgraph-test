import {
  Borrow,
  LendingPool,
  Repay,
  Withdraw,
  Swap,
  ReserveUsedAsCollateralEnabled,
  ReserveUsedAsCollateralDisabled,
  LiquidationCall,
} from "../../generated/LendingPool/LendingPool";
import { Deposit } from "../../generated//LendingPool/LendingPool";
import * as Schemas from "../../generated/schema";
import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";

import { updateBlock } from "../utils/block";

import { IERC20Detailed } from "../../generated/LendingPool/IERC20Detailed";
import { LoadReserve } from "./reserves";

export function updateReserveAmounts(
  reserveAddress: Address,
  poolAddress: Address
): void {
  let pool = LendingPool.bind(poolAddress);
  let reserves = pool.try_getReserveData(reserveAddress);

  if (reserves.reverted) {
    return;
  }
  let reserve = LoadReserve(reserveAddress);
  if (reserve) {
    let ercContract = IERC20Detailed.bind(reserveAddress);
    let balance = ercContract.try_balanceOf(
      Address.fromString(reserve.aTokenAddress.toHexString())
    );

    if (!balance.reverted) {
      reserve.availableLiquidity = balance.value;
    }

    let stableDebtTokenContract = IERC20Detailed.bind(
      Address.fromString(reserve.stableDebtTokenAddress.toHexString())
    );

    let stableDebtTotalSupply = stableDebtTokenContract.try_totalSupply();
    if (!stableDebtTotalSupply.reverted) {
      reserve.totalStableDebt = stableDebtTotalSupply.value;
    }

    let variableDebtTokenContract = IERC20Detailed.bind(
      Address.fromString(reserve.variableDebtTokenAddress.toHexString())
    );

    let variableDebtTotalSupply = variableDebtTokenContract.try_totalSupply();
    if (!variableDebtTotalSupply.reverted) {
      reserve.totalVariableDebt = variableDebtTotalSupply.value;
    }

    reserve.liquidityRate = reserves.value.currentLiquidityRate;
    reserve.variableBorrowRate = reserves.value.currentVariableBorrowRate;
    reserve.stableBorrowRate = reserves.value.currentStableBorrowRate;
    reserve.liquidityIndex = reserves.value.liquidityIndex;
    reserve.variableBorrowIndex = reserves.value.variableBorrowIndex;
    reserve.lastUpdateTimestamp = reserves.value.lastUpdateTimestamp;
    reserve.save();
  }
}

export function updateUserData(
  userAddress: Address,
  poolAddress: Address
): void {
  let user = Schemas.User.load(userAddress.toHexString());

  if (!user) {
    user = new Schemas.User(userAddress.toHexString());
    user.currentLiquidationThreshold = BigInt.fromI32(0);
    user.ltv = BigInt.fromI32(0);
    user.depositAssets = [];
    user.save();
  }

  let poolContract = LendingPool.bind(poolAddress);
  let accountData = poolContract.try_getUserAccountData(userAddress);

  if (accountData.reverted) {
    log.warning("account data missing", []);
  } else {
    user.currentLiquidationThreshold = accountData.value.value3;
    user.ltv = accountData.value.value4;

    user.save();
  }
}

export function updateUserBalances(
  userAddress: Address,
  tokenAddress: Bytes
): void {
  let userTokenAddress = tokenAddress.toHexString() + userAddress.toHexString();
  let userBalance = Schemas.TokenBalance.load(userTokenAddress);
  if (userBalance) {
    let depositAsset = Schemas.DepositAsset.load(userTokenAddress);
    let user = Schemas.User.load(userAddress.toHexString());

    if (!depositAsset) {
      depositAsset = new Schemas.DepositAsset(userTokenAddress);
      depositAsset.isCollateral = true;
      depositAsset.TokenBalance = userBalance.id;
      depositAsset.save();
    }

    if (user) {
      let depositAssets = user.depositAssets;
      if (depositAssets) {
        depositAssets.push(depositAsset.id);
      } else {
        depositAssets = [depositAsset.id];
      }

      user.depositAssets = depositAssets;

      user.save();
    }
  }
}

export function depositToPoolHandler(event: Deposit): void {
  let poolAddress = event.address;
  let reserveAddress = event.params.reserve;
  let reserve = LoadReserve(event.params.reserve);

  if (reserve) {
    updateUserBalances(event.params.user, reserve.aTokenAddress);
  }

  updateUserData(event.params.user, poolAddress);
  updateReserveAmounts(reserveAddress, poolAddress);
  updateBlock(event.block.number, event.block.hash);
}

export function withdrawFromPoolHandler(event: Withdraw): void {
  let poolAddress = event.address;
  let reserveAddress = event.params.reserve;
  let reserve = LoadReserve(event.params.reserve);

  if (reserve) {
    updateUserBalances(event.params.user, reserve.aTokenAddress);
  }

  updateUserData(event.params.user, poolAddress);
  updateReserveAmounts(reserveAddress, poolAddress);
  updateBlock(event.block.number, event.block.hash);
}

export function borrowFromPoolHandler(event: Borrow): void {
  let poolAddress = event.address;
  let reserveAddress = event.params.reserve;

  updateUserData(event.params.user, poolAddress);
  updateReserveAmounts(reserveAddress, poolAddress);
  updateBlock(event.block.number, event.block.hash);
}

export function repayFromPoolHandler(event: Repay): void {
  let poolAddress = event.address;
  let reserveAddress = event.params.reserve;

  updateUserData(event.params.user, poolAddress);
  updateReserveAmounts(reserveAddress, poolAddress);
  updateBlock(event.block.number, event.block.hash);
}

export function swapBorrowMode(event: Swap): void {
  let poolAddress = event.address;
  let reserveAddress = event.params.reserve;

  updateUserData(event.params.user, poolAddress);
  updateReserveAmounts(reserveAddress, poolAddress);
  updateBlock(event.block.number, event.block.hash);
}

export function liquidationCall(event: LiquidationCall): void {
  let poolAddress = event.address;
  let collateralAssetAddress = event.params.collateralAsset;
  let debtAssetAddress = event.params.debtAsset;
  let collateralAsset = LoadReserve(collateralAssetAddress);

  if (collateralAsset) {
    updateReserveAmounts(collateralAssetAddress, poolAddress);
    if (event.params.receiveAToken) {
      updateUserBalances(
        event.params.liquidator,
        collateralAsset.aTokenAddress
      );
    }
  }
  let debtAsset = LoadReserve(debtAssetAddress);
  if (debtAsset) {
    updateReserveAmounts(debtAssetAddress, poolAddress);
    updateUserBalances(event.params.user, debtAsset.aTokenAddress);
  }

  updateUserData(event.params.user, poolAddress);
  updateUserData(event.params.liquidator, poolAddress);
  updateBlock(event.block.number, event.block.hash);
}

export function setAssetAsCollateralEnabled(
  event: ReserveUsedAsCollateralEnabled
): void {
  let reserve = Schemas.Reserve.load(event.params.reserve.toHexString());
  if (reserve) {
    let userTokenAddress =
      reserve.aTokenAddress.toHexString() + event.params.user.toHexString();
    let depositAsset = Schemas.DepositAsset.load(userTokenAddress);
    if (depositAsset) {
      depositAsset.isCollateral = true;
      depositAsset.save();
    }
  }
  let poolAddress = event.address;

  updateUserData(event.params.user, poolAddress);
  updateBlock(event.block.number, event.block.hash);
}

export function setAssetAsCollateralDisabled(
  event: ReserveUsedAsCollateralDisabled
): void {
  let reserve = Schemas.Reserve.load(event.params.reserve.toHexString());

  if (reserve) {
    let userTokenAddress =
      reserve.aTokenAddress.toHexString() + event.params.user.toHexString();
    let depositAsset = Schemas.DepositAsset.load(userTokenAddress);
    if (depositAsset) {
      depositAsset.isCollateral = false;
      depositAsset.save();
    }
  }
  let poolAddress = event.address;

  updateUserData(event.params.user, poolAddress);
  updateBlock(event.block.number, event.block.hash);
}
