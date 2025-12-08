import { describe, it, expect } from 'vitest';
import {
  getResponseTypeInfo,
  formatConfidenceScore,
  formatSource,
  formatPlanStep,
  requiresUserAction,
  getNextActionHint,
  formatResponseForDisplay,
  extractActionableItems,
  RESPONSE_TYPE_INFO
} from '../../lib/utils/response-handlers';
import {
  ResponseType,
  AgentResponse,
  Source,
  PlanStep,
  InvestigationMode,
  CaseStatus
} from '../../lib/api';

// Test helper: Create minimal AgentResponse with required v3.1.0 fields
function createTestResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    response_type: ResponseType.ANSWER,
    content: 'Test response',
    session_id: 'test-session-123',
    evidence_requests: [],
    investigation_mode: InvestigationMode.ACTIVE_INCIDENT,
    case_status: 'investigating',
    ...overrides
  };
}

describe('Response Handlers', () => {
  describe('RESPONSE_TYPE_INFO', () => {
    it('contains all response types', () => {
      expect(RESPONSE_TYPE_INFO[ResponseType.ANSWER]).toBeDefined();
      expect(RESPONSE_TYPE_INFO[ResponseType.PLAN_PROPOSAL]).toBeDefined();
      expect(RESPONSE_TYPE_INFO[ResponseType.CLARIFICATION_REQUEST]).toBeDefined();
      expect(RESPONSE_TYPE_INFO[ResponseType.CONFIRMATION_REQUEST]).toBeDefined();
      expect(RESPONSE_TYPE_INFO[ResponseType.SOLUTION_READY]).toBeDefined();
      expect(RESPONSE_TYPE_INFO[ResponseType.NEEDS_MORE_DATA]).toBeDefined();
      expect(RESPONSE_TYPE_INFO[ResponseType.ESCALATION_REQUIRED]).toBeDefined();
    });

    it('has correct structure for each response type', () => {
      Object.values(RESPONSE_TYPE_INFO).forEach(info => {
        expect(info).toHaveProperty('label');
        expect(info).toHaveProperty('emoji');
        expect(info).toHaveProperty('description');
        expect(info).toHaveProperty('color');
        expect(info).toHaveProperty('actionRequired');
      });
    });
  });

  describe('getResponseTypeInfo', () => {
    it('returns correct info for ANSWER response type', () => {
      const info = getResponseTypeInfo(ResponseType.ANSWER);
      expect(info.label).toBe('Answer');
      expect(info.emoji).toBe('💬');
      expect(info.actionRequired).toBe(false);
    });

    it('returns correct info for PLAN_PROPOSAL response type', () => {
      const info = getResponseTypeInfo(ResponseType.PLAN_PROPOSAL);
      expect(info.label).toBe('Troubleshooting Plan');
      expect(info.emoji).toBe('📋');
      expect(info.actionRequired).toBe(true);
    });
  });

  describe('formatConfidenceScore', () => {
    it('formats high confidence correctly', () => {
      const result = formatConfidenceScore(0.95);
      expect(result.display).toBe('95%');
      expect(result.emoji).toBe('🟢');
      expect(result.color).toBe('text-green-600');
    });

    it('formats medium confidence correctly', () => {
      const result = formatConfidenceScore(0.75);
      expect(result.display).toBe('75%');
      expect(result.emoji).toBe('🟡');
      expect(result.color).toBe('text-yellow-600');
    });

    it('formats low confidence correctly', () => {
      const result = formatConfidenceScore(0.45);
      expect(result.display).toBe('45%');
      expect(result.emoji).toBe('🔴');
      expect(result.color).toBe('text-red-600');
    });
  });

  describe('formatSource', () => {
    it('formats log analysis source correctly', () => {
      const source: Source = {
        type: 'log_analysis',
        content: 'Error logs show connection timeout',
        confidence: 0.9
      };
      
      const result = formatSource(source);
      expect(result.emoji).toBe('📝');
      expect(result.label).toBe('Log Analysis');
      expect(result.content).toBe('Error logs show connection timeout');
      expect(result.confidence).toBe('90%');
    });

    it('formats knowledge base source correctly', () => {
      const source: Source = {
        type: 'knowledge_base',
        content: 'Database troubleshooting guide',
        confidence: 0.8
      };
      
      const result = formatSource(source);
      expect(result.emoji).toBe('📚');
      expect(result.label).toBe('Knowledge Base');
      expect(result.content).toBe('Database troubleshooting guide');
      expect(result.confidence).toBe('80%');
    });
  });

  describe('formatPlanStep', () => {
    it('formats plan step correctly', () => {
      const step: PlanStep = {
        step_number: 1,
        action: 'Check system logs',
        description: 'Review recent error logs for clues',
        estimated_time: '5 minutes',
        dependencies: [],
        required_tools: ['log viewer']
      };
      
      const result = formatPlanStep(step);
      expect(result.stepNumber).toBe('Step 1');
      expect(result.action).toBe('Check system logs');
      expect(result.description).toBe('Review recent error logs for clues');
      expect(result.estimatedTime).toBe('5 minutes');
      expect(result.requiredTools).toBe('Tools: log viewer');
    });

    it('handles step with dependencies', () => {
      const step: PlanStep = {
        step_number: 2,
        action: 'Restart service',
        description: 'Restart the failing service',
        estimated_time: '2 minutes',
        dependencies: [1],
        required_tools: ['ssh', 'systemctl']
      };
      
      const result = formatPlanStep(step);
      expect(result.dependencies).toBe('Depends on: 1');
      expect(result.requiredTools).toBe('Tools: ssh, systemctl');
    });
  });

  describe('requiresUserAction', () => {
    it('returns false for ANSWER response type', () => {
      const response = createTestResponse({
        response_type: ResponseType.ANSWER,
        content: 'This is an answer'
      });

      expect(requiresUserAction(response)).toBe(false);
    });

    it('returns true for CLARIFICATION_REQUEST response type', () => {
      const response = createTestResponse({
        response_type: ResponseType.CLARIFICATION_REQUEST,
        content: 'I need more information'
      });

      expect(requiresUserAction(response)).toBe(true);
    });

    it('returns false for null or undefined response', () => {
      expect(requiresUserAction(null as any)).toBe(false);
      expect(requiresUserAction(undefined as any)).toBe(false);
    });

    it('returns false for response without response_type', () => {
      const response = {
        content: 'This is a response',
        session_id: 'session-123'
      } as AgentResponse;
      
      expect(requiresUserAction(response)).toBe(false);
    });

    it('returns false for response with unknown response_type', () => {
      const response = createTestResponse({
        response_type: 'UNKNOWN_TYPE' as ResponseType,
        content: 'This is a response'
      });

      expect(requiresUserAction(response)).toBe(false);
    });
  });

  describe('getNextActionHint', () => {
    it('returns custom hint when provided', () => {
      const response = createTestResponse({
        response_type: ResponseType.CLARIFICATION_REQUEST,
        content: 'Need more details',
        next_action_hint: 'Please provide error logs'
      });

      expect(getNextActionHint(response)).toBe('Please provide error logs');
    });

    it('returns default hint for CLARIFICATION_REQUEST', () => {
      const response = createTestResponse({
        response_type: ResponseType.CLARIFICATION_REQUEST,
        content: 'Need more details'
      });

      expect(getNextActionHint(response)).toBe('Please provide more details about your issue');
    });
  });

  describe('formatResponseForDisplay', () => {
    it('formats ANSWER response correctly', () => {
      const response = createTestResponse({
        response_type: ResponseType.ANSWER,
        content: 'Your service is failing because...',
        confidence_score: 0.9
      });

      const result = formatResponseForDisplay(response);
      expect(result).toBe('Your service is failing because...');
    });

    it('formats PLAN_PROPOSAL response correctly', () => {
      const response = createTestResponse({
        response_type: ResponseType.PLAN_PROPOSAL,
        content: 'Here is a plan to fix the issue',
        plan: {
          step_number: 1,
          action: 'Check logs',
          description: 'Review error logs',
          estimated_time: '5 minutes'
        },
        confidence_score: 0.9
      });

      const result = formatResponseForDisplay(response);
      expect(result).toBe('Here is a plan to fix the issue');
    });

    it('handles invalid response gracefully', () => {
      const result1 = formatResponseForDisplay(null as any);
      expect(result1).toBe('Error: Invalid response received from server');

      const result2 = formatResponseForDisplay(undefined as any);
      expect(result2).toBe('Error: Invalid response received from server');

      const result3 = formatResponseForDisplay('invalid' as any);
      expect(result3).toBe('Error: Invalid response received from server');
    });

    it('handles response with missing content gracefully', () => {
      const response = {
        response_type: ResponseType.ANSWER,
        session_id: 'session-123'
      } as AgentResponse;
      
      const result = formatResponseForDisplay(response);
      expect(result).toBe(''); // Should return empty string for missing content
    });
  });

  describe('extractActionableItems', () => {
    it('extracts upload action for NEEDS_MORE_DATA', () => {
      const response = createTestResponse({
        response_type: ResponseType.NEEDS_MORE_DATA,
        content: 'Need more data'
      });

      const items = extractActionableItems(response);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('upload');
      expect(items[0].priority).toBe('high');
    });

    it('extracts confirm action for CONFIRMATION_REQUEST', () => {
      const response = createTestResponse({
        response_type: ResponseType.CONFIRMATION_REQUEST,
        content: 'Please confirm'
      });

      const items = extractActionableItems(response);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('confirm');
      expect(items[0].priority).toBe('high');
    });

    it('extracts implement action for SOLUTION_READY', () => {
      const response = createTestResponse({
        response_type: ResponseType.SOLUTION_READY,
        content: 'Solution ready'
      });

      const items = extractActionableItems(response);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('implement');
      expect(items[0].priority).toBe('medium');
    });
  });
});
