/**
 * BanditTracker
 *
 * Tracks success/failure outcomes for (frequency, recipient) pairs
 * using a Beta-Binomial conjugate prior model (Thompson sampling).
 *
 * Each pair maintains:
 * - successCount: number of successful deliveries
 * - failureCount: number of failed deliveries
 * - samples: timestamped history of outcomes
 */

export interface BanditOutcome {
  timestamp: number;
  success: boolean;
}

export interface BanditArmStats {
  successCount: number;
  failureCount: number;
  totalAttempts: number;
  successRate: number;
  outcomes: BanditOutcome[];
}

export interface BanditStats {
  [key: string]: BanditArmStats; // key = "frequency:recipientId"
}

export class BanditTracker {
  private stats: Map<string, BanditArmStats> = new Map();
  private maxHistorySize = 100; // Keep last 100 outcomes per arm

  /**
   * Record a message send attempt
   */
  recordAttempt(frequency: number, recipientId: number, success: boolean, tick: number) {
    const key = this.getKey(frequency, recipientId);
    
    if (!this.stats.has(key)) {
      this.stats.set(key, {
        successCount: 0,
        failureCount: 0,
        totalAttempts: 0,
        successRate: 0,
        outcomes: [],
      });
    }

    const arm = this.stats.get(key)!;
    
    if (success) {
      arm.successCount++;
    } else {
      arm.failureCount++;
    }
    
    arm.totalAttempts++;
    
    // Update success rate
    arm.successRate = arm.successCount / arm.totalAttempts;
    
    // Add to outcomes history (keep only recent ones)
    arm.outcomes.push({ timestamp: tick, success });
    if (arm.outcomes.length > this.maxHistorySize) {
      arm.outcomes.shift();
    }
  }

  /**
   * Get stats for a specific (frequency, recipient) pair
   */
  getArmStats(frequency: number, recipientId: number): BanditArmStats | null {
    const key = this.getKey(frequency, recipientId);
    return this.stats.get(key) || null;
  }

  /**
   * Get all stats
   */
  getAllStats(): BanditStats {
    const result: BanditStats = {};
    for (const [key, stats] of this.stats) {
      result[key] = stats;
    }
    return result;
  }

  /**
   * Get stats organized by recipient
   */
  getStatsByRecipient(): Record<number, BanditArmStats[]> {
    const result: Record<number, BanditArmStats[]> = {};
    
    for (const [key, stats] of this.stats) {
      const [, recipStr] = key.split(':');
      const recipientId = parseInt(recipStr, 10);
      
      if (!result[recipientId]) {
        result[recipientId] = [];
      }
      result[recipientId].push(stats);
    }
    
    return result;
  }

  /**
   * Get Thompson sampling score (for arm selection)
   * Uses Beta distribution: Beta(α, β) where α = successes, β = failures
   * Adds pseudo-counts for exploration (1, 1) for Laplace smoothing
   * Incorporates frequency as a weight factor (direct=1 is more reliable than routed=2)
   */
  getThompsonScore(frequency: number, recipientId: number): number {
    const arm = this.getArmStats(frequency, recipientId);
    if (!arm) return 0.5; // No data yet, assume neutral
    
    const alpha = arm.successCount + 1; // Laplace smoothing
    const beta = arm.failureCount + 1;
    
    // Base Thompson score: Mean of Beta(α, β) = α / (α + β)
    const baseScore = alpha / (alpha + beta);
    
    // Weight by frequency: direct messages (frequency=1) are inherently more reliable
    // Frequency-weighted score: higher frequency = higher baseline confidence
    // frequency=1 (direct): multiplier = 1.0 (100% confidence in direct)
    // frequency=2 (routed): multiplier = 0.8 (80% confidence in routed)
    const frequencyMultiplier = frequency === 1 ? 1.0 : Math.max(0.5, 1.0 - (frequency - 1) * 0.2);
    
    // Apply frequency weighting while preserving Thompson property
    return baseScore * frequencyMultiplier;
  }

  /**
   * Get frequency-adjusted score with confidence bounds
   * Returns base Thompson score weighted by frequency and attempt count
   * Useful for arm selection with consideration of both reliability and sample size
   */
  getFrequencyWeightedScore(frequency: number, recipientId: number): number {
    const arm = this.getArmStats(frequency, recipientId);
    if (!arm || arm.totalAttempts === 0) {
      return 0.5 * (frequency === 1 ? 1.0 : 0.8); // Default with frequency weighting
    }
    
    // Base Thompson score
    const alpha = arm.successCount + 1;
    const beta = arm.failureCount + 1;
    const baseScore = alpha / (alpha + beta);
    
    // Frequency multiplier
    const frequencyMultiplier = frequency === 1 ? 1.0 : Math.max(0.5, 1.0 - (frequency - 1) * 0.2);
    
    // Apply minimum sample size confidence penalty
    // With fewer than 5 attempts, reduce confidence slightly
    const sampleConfidence = Math.min(1.0, arm.totalAttempts / 5.0);
    
    return baseScore * frequencyMultiplier * sampleConfidence;
  }

  /**
   * Get all recipients sorted by success rate
   */
  getRecipientsRanked(): Array<{ recipientId: number; avgSuccessRate: number; totalAttempts: number }> {
    const byRecipient = this.getStatsByRecipient();
    const result = [];
    
    for (const [recipId, arms] of Object.entries(byRecipient)) {
      const recipientId = parseInt(recipId, 10);
      const totalAttempts = arms.reduce((sum, arm) => sum + arm.totalAttempts, 0);
      const totalSuccesses = arms.reduce((sum, arm) => sum + arm.successCount, 0);
      const avgSuccessRate = totalAttempts > 0 ? totalSuccesses / totalAttempts : 0;
      
      result.push({
        recipientId,
        avgSuccessRate,
        totalAttempts,
      });
    }
    
    return result.sort((a, b) => b.avgSuccessRate - a.avgSuccessRate);
  }

  /**
   * Reset all tracking data
   */
  reset() {
    this.stats.clear();
  }

  /**
   * Generate key for a (frequency, recipient) pair
   */
  private getKey(frequency: number, recipientId: number): string {
    return `${frequency}:${recipientId}`;
  }

  /**
   * Get size of tracker (number of arms being tracked)
   */
  getSize(): number {
    return this.stats.size;
  }

  /**
   * Parse frequency from key (format: "frequency:recipientId")
   */
  private parseFrequency(key: string): number {
    return parseInt(key.split(':')[0], 10);
  }

  /**
   * Get best recipient considering frequency weighting
   * Returns the recipient with highest frequency-weighted success score
   */
  getBestRecipientByFrequency(singleHopOnly = false): { 
    recipientId: number; 
    frequency: number; 
    score: number;
    successRate: number;
  } | null {
    let bestScore = -1;
    let bestResult = null;
    
    for (const [key, stats] of this.stats) {
      const [freqStr, recipStr] = key.split(':');
      const frequency = parseInt(freqStr, 10);
      const recipientId = parseInt(recipStr, 10);
      
      // Skip multi-hop destinations if single-hop only requested
      if (singleHopOnly && frequency !== 1) continue;
      
      const score = this.getFrequencyWeightedScore(frequency, recipientId);
      
      if (score > bestScore) {
        bestScore = score;
        bestResult = {
          recipientId,
          frequency,
          score,
          successRate: stats.successRate,
        };
      }
    }
    
    return bestResult;
  }
}
