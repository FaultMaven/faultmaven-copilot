import React from 'react';

interface ClarifyingQuestionsProps {
  questions: string[];
  onQuestionClick?: (question: string) => void;
}

/**
 * Clarifying Questions Component
 * Displays questions to better understand user intent
 * Part of OODA Framework v3.2.0 implementation
 */
export const ClarifyingQuestions: React.FC<ClarifyingQuestionsProps> = ({ questions, onQuestionClick }) => {
  if (!questions || questions.length === 0) {
    return null;
  }

  const handleQuestionClick = (question: string) => {
    if (onQuestionClick) {
      onQuestionClick(question);
    }
  };

  return (
    <div className="clarifying-questions bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-shrink-0">
          <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-900 mb-1">
            I need a bit more information
          </h3>
          <p className="text-xs text-amber-700">
            To better help you, could you clarify one of these points?
          </p>
        </div>
      </div>

      {/* Questions List */}
      <div className="space-y-2">
        {questions.map((question, index) => (
          <div
            key={index}
            className={`
              question-item flex items-start gap-3 p-3 rounded-md
              bg-white border border-amber-200
              ${onQuestionClick ? 'cursor-pointer hover:bg-amber-50 hover:border-amber-300 transition-colors' : ''}
            `}
            onClick={() => onQuestionClick && handleQuestionClick(question)}
            role={onQuestionClick ? 'button' : undefined}
            tabIndex={onQuestionClick ? 0 : undefined}
          >
            {/* Question Number Badge */}
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-bold">
              {index + 1}
            </div>

            {/* Question Text */}
            <p className="flex-1 text-sm text-gray-800">
              {question}
            </p>

            {/* Click Indicator */}
            {onQuestionClick && (
              <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        ))}
      </div>

      {/* Footer Hint */}
      {onQuestionClick && (
        <div className="mt-3 text-xs text-amber-700 italic flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          Click a question to use it as your next message
        </div>
      )}
    </div>
  );
};
