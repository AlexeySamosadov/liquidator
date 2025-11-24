import fs from 'fs/promises';
import { BotConfig, EmergencyStopState, RiskCheckResult, RiskCheckType } from '../../types';
import { logger } from '../../utils/logger';

class EmergencyStop {
  private state: EmergencyStopState = { isActive: false };

  private readonly filePath: string;

  constructor(config: BotConfig) {
    this.filePath = config.emergencyStopFile || './emergency_stop.flag';
  }

  async initialize(): Promise<void> {
    try {
      await fs.access(this.filePath);
      const content = await fs.readFile(this.filePath, 'utf-8').catch(() => '');
      if (content) {
        this.state = { ...this.state, ...(JSON.parse(content) as EmergencyStopState), isActive: true };
      } else {
        this.state = { isActive: true, reason: 'Manual emergency stop flag present' };
      }
      logger.warn('Emergency stop is active from flag file', { file: this.filePath });
    } catch {
      this.state = { isActive: false };
    }
  }

  async checkEmergencyStop(): Promise<RiskCheckResult> {
    try {
      await fs.access(this.filePath);
      if (!this.state.isActive) {
        await this.activate('Manual emergency stop');
      }
    } catch {
      // file not present; continue
    }

    if (this.state.isActive) {
      logger.warn('Emergency stop active', { reason: this.state.reason });
      return {
        passed: false,
        checkType: RiskCheckType.EMERGENCY_STOP,
        reason: this.state.reason || 'Emergency stop active',
        details: this.state,
      };
    }

    return { passed: true, checkType: RiskCheckType.EMERGENCY_STOP };
  }

  async activate(reason: string, activatedBy: string = 'automatic'): Promise<void> {
    this.state = {
      isActive: true,
      reason,
      activatedAt: Date.now(),
      activatedBy,
    };
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
    logger.error('Emergency stop activated', { reason, file: this.filePath });
  }

  async deactivate(): Promise<void> {
    this.state = { isActive: false };
    try {
      await fs.unlink(this.filePath);
    } catch {
      // ignore missing file
    }
    logger.info('Emergency stop deactivated');
  }

  isActive(): boolean {
    return this.state.isActive;
  }

  getState(): EmergencyStopState {
    return this.state;
  }
}

export default EmergencyStop;
