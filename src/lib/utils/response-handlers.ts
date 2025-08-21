import { ResponseType, AgentResponse, Source, PlanStep } from '../api';

/**
 * Utility functions for handling the new v3.1.0 API response types
 */

export interface ResponseTypeInfo {
  label: string;
  emoji: string;
  description: string;
  color: string;
  actionRequired: boolean;
}

export const RESPONSE_TYPE_INFO: Record<ResponseType, ResponseTypeInfo> = {
  [ResponseType.ANSWER]: {
    label: 'Answer',
    emoji: '💬',
    description: 'Direct answer to your query',
    color: 'text-green-600',
    actionRequired: false
  },
  [ResponseType.PLAN_PROPOSAL]: {
    label: 'Troubleshooting Plan',
    emoji: '📋',
    description: 'Step-by-step plan to resolve the issue',
    color: 'text-blue-600',
    actionRequired: true
  },
  [ResponseType.CLARIFICATION_REQUEST]: {
    label: 'Need More Information',
    emoji: '❓',
    description: 'AI needs additional details to help you',
    color: 'text-yellow-600',
    actionRequired: true
  },
  [ResponseType.CONFIRMATION_REQUEST]: {
    label: 'Please Confirm',
    emoji: '✅',
    description: 'AI needs your confirmation before proceeding',
    color: 'text-orange-600',
    actionRequired: true
  },
  [ResponseType.SOLUTION_READY]: {
    label: 'Solution Ready',
    emoji: '🎯',
    description: 'Solution is ready to implement',
    color: 'text-green-600',
    actionRequired: false
  },
  [ResponseType.NEEDS_MORE_DATA]: {
    label: 'Need More Data',
    emoji: '📊',
    description: 'AI needs additional data to continue',
    color: 'text-purple-600',
    actionRequired: true
  },
  [ResponseType.ESCALATION_REQUIRED]: {
    label: 'Escalation Required',
    emoji: '🚨',
    description: 'Issue escalated to human support',
    color: 'text-red-600',
    actionRequired: true
  }
};

/**
 * Get formatted response type information with safety check
 */
export function getResponseTypeInfo(responseType: ResponseType): ResponseTypeInfo {
  if (!responseType || !RESPONSE_TYPE_INFO[responseType]) {
    console.warn('[ResponseHandlers] Unknown response type:', responseType);
    return {
      label: 'Response',
      emoji: '💬',
      description: 'System response',
      color: 'text-gray-600',
      actionRequired: false
    };
  }
  return RESPONSE_TYPE_INFO[responseType];
}

/**
 * Format confidence score with emoji and color
 */
export function formatConfidenceScore(score: number): {
  display: string;
  emoji: string;
  color: string;
} {
  if (score >= 0.9) {
    return { display: `${Math.round(score * 100)}%`, emoji: '🟢', color: 'text-green-600' };
  } else if (score >= 0.7) {
    return { display: `${Math.round(score * 100)}%`, emoji: '🟡', color: 'text-yellow-600' };
  } else if (score >= 0.5) {
    return { display: `${Math.round(score * 100)}%`, emoji: '🟠', color: 'text-orange-600' };
  } else {
    return { display: `${Math.round(score * 100)}%`, emoji: '🔴', color: 'text-red-600' };
  }
}

/**
 * Format source information with appropriate emoji
 */
export function formatSource(source: Source): {
  emoji: string;
  label: string;
  content: string;
  confidence?: string;
} {
  const sourceEmojis: Record<string, string> = {
    'log_analysis': '📝',
    'knowledge_base': '📚',
    'user_input': '👤',
    'system_metrics': '📊',
    'external_api': '🔗',
    'previous_case': '🔍'
  };

  const sourceLabels: Record<string, string> = {
    'log_analysis': 'Log Analysis',
    'knowledge_base': 'Knowledge Base',
    'user_input': 'User Input',
    'system_metrics': 'System Metrics',
    'external_api': 'External API',
    'previous_case': 'Previous Case'
  };

  const content = source.content;

  return {
    emoji: sourceEmojis[source.type] || '📄',
    label: sourceLabels[source.type] || source.type,
    content: content,
    confidence: source.confidence ? `${Math.round(source.confidence * 100)}%` : undefined
  };
}

/**
 * Format plan step information
 */
export function formatPlanStep(step: PlanStep): {
  stepNumber: string;
  action: string;
  description: string;
  estimatedTime?: string;
  dependencies?: string;
  requiredTools?: string;
} {
  return {
    stepNumber: `Step ${step.step_number}`,
    action: step.action,
    description: step.description,
    estimatedTime: step.estimated_time,
    dependencies: step.dependencies?.length ? `Depends on: ${step.dependencies.join(', ')}` : undefined,
    requiredTools: step.required_tools?.length ? `Tools: ${step.required_tools.join(', ')}` : undefined
  };
}

/**
 * Check if response requires user action
 */
export function requiresUserAction(response: AgentResponse): boolean {
  if (!response || !response.response_type) {
    console.warn('[ResponseHandlers] Missing response_type in response:', response);
    return false;
  }
  
  const typeInfo = RESPONSE_TYPE_INFO[response.response_type];
  if (!typeInfo) {
    console.warn('[ResponseHandlers] Unknown response_type:', response.response_type);
    return false;
  }
  
  return typeInfo.actionRequired;
}

/**
 * Get next action hint for user
 */
export function getNextActionHint(response: AgentResponse): string | null {
  if (response.next_action_hint) {
    return response.next_action_hint;
  }

  // Provide default hints based on response type
  switch (response.response_type) {
    case ResponseType.CLARIFICATION_REQUEST:
      return 'Please provide more details about your issue';
    case ResponseType.CONFIRMATION_REQUEST:
      return 'Please confirm if you want to proceed with the suggested action';
    case ResponseType.NEEDS_MORE_DATA:
      return 'Please upload additional data or logs to continue';
    case ResponseType.PLAN_PROPOSAL:
      return 'Review the plan and let me know if you want to proceed';
    case ResponseType.ESCALATION_REQUIRED:
      return 'This issue requires human intervention. Please contact support.';
    default:
      return null;
  }
}

/**
 * Format the complete response for display with comprehensive error handling
 */
export function formatResponseForDisplay(response: AgentResponse): string {
  // Defensive programming: ensure response is valid
  if (!response || typeof response !== 'object') {
    console.error('[ResponseHandlers] Invalid response object:', response);
    return 'Error: Invalid response received from server';
  }
  
  // Return just the content without any formatting
  return response.content || '';
}

/**
 * Extract actionable items from response
 */
export function extractActionableItems(response: AgentResponse): Array<{
  type: 'upload' | 'confirm' | 'clarify' | 'implement' | 'contact_support';
  description: string;
  priority: 'high' | 'medium' | 'low';
}> {
  const items: Array<{
    type: 'upload' | 'confirm' | 'clarify' | 'implement' | 'contact_support';
    description: string;
    priority: 'high' | 'medium' | 'low';
  }> = [];

  switch (response.response_type) {
    case ResponseType.NEEDS_MORE_DATA:
      items.push({
        type: 'upload',
        description: 'Upload additional data or logs',
        priority: 'high'
      });
      break;
    case ResponseType.CONFIRMATION_REQUEST:
      items.push({
        type: 'confirm',
        description: 'Confirm the proposed action',
        priority: 'high'
      });
      break;
    case ResponseType.CLARIFICATION_REQUEST:
      items.push({
        type: 'clarify',
        description: 'Provide additional details',
        priority: 'high'
      });
      break;
    case ResponseType.SOLUTION_READY:
      items.push({
        type: 'implement',
        description: 'Implement the provided solution',
        priority: 'medium'
      });
      break;
    case ResponseType.ESCALATION_REQUIRED:
      items.push({
        type: 'contact_support',
        description: 'Contact human support team',
        priority: 'high'
      });
      break;
  }

  return items;
}
