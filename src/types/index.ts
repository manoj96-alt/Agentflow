export type AgentModel =
  | 'claude-opus-4-5'
  | 'claude-sonnet-4-5'
  | 'claude-haiku-4-5'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gemini-1.5-pro'
  | 'gemini-1.5-flash'

export type AgentRole =
  | 'orchestrator'
  | 'planner'      // decides which workers to call and in what order
  | 'worker'       // executes a specific task
  | 'evaluator'    // validates output and decides pass/retry
  | 'researcher'
  | 'coder'
  | 'reviewer'
  | 'custom'

// ─── Agent message passing ─────────────────────────────────────────────────
/** A message sent from one agent to another via shared state. */
export interface AgentMessage {
  from:      string        // sender nodeId
  to:        string        // recipient nodeId or 'broadcast'
  content:   string        // message body
  type:      'instruction' | 'result' | 'question' | 'feedback'
  timestamp: number
  iteration: number
}

// ─── Planner mode ─────────────────────────────────────────────────────────
/** A step in a dynamically generated execution plan. */
export interface PlanStep {
  nodeId:      string
  agentName:   string
  role:        AgentRole
  instruction: string      // specific task for this step
  dependsOn:   string[]    // nodeIds that must complete first
  condition?:  string      // optional condition to skip this step
}

export interface ExecutionPlan {
  planId:       string
  goal:         string
  steps:        PlanStep[]
  generatedBy:  string     // planner nodeId
  timestamp:    number
}

export interface AgentNodeData {
  agentName: string
  role: AgentRole
  model: AgentModel
  prompt: string
  temperature: number
  maxTokens: number
  status: 'idle' | 'running' | 'success' | 'error' | 'skipped'
  description?: string
  iterationCount?: number
  lastOutput?: string
  attachedTools?: string[]  // MCP tool names attached to this agent
}

// ─── Conditional edge ─────────────────────────────────────────────────────────

/**
 * EdgeCondition — evaluated against the shared FlowState after the source
 * node completes. If the condition is falsy the edge is skipped and the
 * target node is not enqueued.
 *
 * condition string examples:
 *   "state['score'] > 80"
 *   "state['status'] === 'approved'"
 *   "state['reviewer:approved'] === true"
 *   "state['retry_count'] < 3"
 *   ""   ← empty / absent = unconditional (always route)
 */
export interface EdgeCondition {
  expression: string          // JS expression; receives `state` variable
  label?: string              // human label shown on edge, e.g. "score > 80"
  description?: string        // tooltip / docs
}

// ─── Execution engine types ───────────────────────────────────────────────────

export type FlowState = Record<string, unknown>
export type NodeStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'retrying' | 'healed'

export interface NodeIORecord {
  inputs: FlowState
  outputs: FlowState
  toolsUsed?: string[]
  llmPrompt?: string
  llmResponse?: string
}

export interface EdgeRoutingRecord {
  edgeId: string
  source: string
  target: string
  condition: string
  result: boolean       // true = routed, false = skipped
  error?: string        // if condition evaluation threw
}

export interface RetryRecord {
  attempt:    number         // 1-based retry number
  model:      string         // model used in this attempt
  error:      string         // error that triggered retry
  durationMs: number
  strategy:   'backup_model' | 'reduced_tokens' | 'simplified_prompt' | 'tool_fallback'
}

export interface ExecutionLog {
  nodeId: string
  nodeName: string
  role: string
  model: string               // final model used (may differ from configured after healing)
  modelUsed: string           // actual model that produced the successful output
  iteration: number
  status: NodeStatus
  message: string
  timestamp: number
  durationMs?: number
  io: NodeIORecord
  routing?: EdgeRoutingRecord[]
  error?: string
  stateSnapshot: FlowState
  // Adaptive execution fields
  retries?:       RetryRecord[]      // all retry attempts before success/failure
  healed?:        boolean            // true if recovered after failure
  healStrategy?:  string             // what strategy fixed it
  skippedReason?: string             // why this node was skipped (condition/dependency)
  toolFallback?:  boolean            // true if tool failed and LLM was used instead
}

export interface NodeExecutionSummary {
  nodeId:       string
  nodeName:     string
  status:       NodeStatus
  totalRetries: number
  healed:       boolean
  modelsUsed:   string[]   // all models attempted
  finalModel:   string     // model that succeeded
  durationMs:   number
  toolFallback: boolean
}

export interface ExecutionResult {
  success: boolean
  totalSteps: number
  iterations: Record<string, number>
  loopsDetected: boolean
  terminatedEarly: boolean
  conditionalsEvaluated: number
  conditionalsSkipped: number
  logs: ExecutionLog[]
  finalState: FlowState
  durationMs: number
  // Adaptive execution stats
  totalRetries:    number
  healedNodes:     number
  failedNodes:     string[]           // nodeIds that failed even after all retries
  skippedNodes:    string[]           // nodeIds skipped due to conditions
  nodeSummaries:   NodeExecutionSummary[]
}

export interface ExecutionOptions {
  maxIterations?: number
  stepDelayMs?: number
  testMode?: boolean              // if true: inject testInputs into initial state, don't save
  testInputs?: Record<string, unknown>  // seed values for the shared state
  expectedOutputs?: TestAssertion[]     // assertions to check after execution
}

export interface TestAssertion {
  key: string           // state key to check, e.g. "reviewer:approved"
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'exists'
  expected: unknown     // expected value
  description?: string  // human label
}

export interface TestResult {
  assertion: TestAssertion
  actual: unknown
  passed: boolean
  message: string
}

export interface TestRunResult extends ExecutionResult {
  testMode: true
  testResults: TestResult[]
  passCount: number
  failCount: number
}

// ─── Flow graph types ─────────────────────────────────────────────────────────

export interface FlowGraph {
  id: string
  name: string
  description: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  created_at: string
  updated_at: string
}

export interface FlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: AgentNodeData
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  label?: string
  animated?: boolean
  condition?: EdgeCondition
  isLoopback?: boolean        // true when edge creates a cycle
  loopMaxIter?: number        // per-edge override for max iterations
}

// ─── Workflow JSON schema ─────────────────────────────────────────────────────

/**
 * Full workflow export schema — used for save/load and replay.
 * Includes conditions, loop indicators and per-node state protocol hints.
 */
export interface WorkflowSchema {
  version: '2'
  id?: string
  name: string
  description?: string
  maxIterations: number
  nodes: WorkflowSchemaNode[]
  edges: WorkflowSchemaEdge[]
  metadata?: {
    createdAt: string
    tags: string[]
  }
}

export interface WorkflowSchemaNode {
  id: string
  type: 'agent'
  position: { x: number; y: number }
  data: {
    agentName: string
    role: string
    model: string
    prompt: string
    temperature: number
    maxTokens: number
    attachedTools?: string[]
    // State protocol hints (auto-populated by optimizer)
    stateReads?: string[]   // keys this node reads from state
    stateWrites?: string[]  // keys this node writes to state
  }
}

export interface WorkflowSchemaEdge {
  id: string
  source: string
  target: string
  label?: string
  animated?: boolean
  condition?: EdgeCondition  // conditional routing expression
  isLoopback?: boolean       // true = creates a cycle (shown with loop indicator)
  loopMaxIter?: number       // max times this loopback can fire
}
