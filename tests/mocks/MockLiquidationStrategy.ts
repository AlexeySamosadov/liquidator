import { LiquidatablePosition, LiquidationMode } from '../../src/types';

export class MockLiquidationStrategy {
  private mode: LiquidationMode = LiquidationMode.STANDARD;

  private validation = true;

  private selectHistory: LiquidatablePosition[] = [];

  private validateHistory: { position: LiquidatablePosition; mode: LiquidationMode }[] = [];

  mockSelectedMode(mode: LiquidationMode) {
    this.mode = mode;
  }

  mockFlashLoanMode() {
    this.mode = LiquidationMode.FLASH_LOAN;
  }

  mockValidation(valid: boolean) {
    this.validation = valid;
  }

  mockValidationFailure() {
    this.validation = false;
  }

  getSelectHistory() {
    return this.selectHistory;
  }

  getValidateHistory() {
    return this.validateHistory;
  }

  async selectStrategy(position: LiquidatablePosition): Promise<LiquidationMode> {
    this.selectHistory.push(position);
    return this.mode;
  }

  async validateStrategy(position: LiquidatablePosition, mode: LiquidationMode): Promise<boolean> {
    this.validateHistory.push({ position, mode });
    return this.validation;
  }
}

export default MockLiquidationStrategy;
