/**
 * templates.ts — Prebuilt workflow templates
 * 6 templates covering common enterprise and research patterns
 */
import type { AgentRole, AgentModel } from '../types'

interface TemplateNode {
  id: string
  type: 'agent'
  position: { x: number; y: number }
  data: {
    agentName: string
    role: AgentRole
    model: AgentModel
    prompt: string
    temperature: number
    maxTokens: number
    status: 'idle'
    description: string
    attachedTools: string[]
  }
}

interface TemplateEdge {
  id: string
  source: string
  target: string
  animated?: boolean
  label?: string
  style?: Record<string, unknown>
  data?: Record<string, unknown>
}

interface Template {
  name: string
  description: string
  category: string
  icon: string
  nodes: TemplateNode[]
  edges: TemplateEdge[]
}

const n = (
  id: string, role: AgentRole, name: string, prompt: string,
  x: number, y: number,
  model: AgentModel = 'claude-sonnet-4-5',
  tools: string[] = [],
  temp?: number,
): TemplateNode => ({
  id, type: 'agent', position: { x, y },
  data: {
    agentName: name, role, model, prompt,
    temperature: temp ?? (role === 'orchestrator' ? 0.2 : role === 'coder' ? 0.1 : 0.4),
    maxTokens: role === 'reviewer' ? 2048 : 1024,
    status: 'idle', description: '',
    attachedTools: tools,
  },
})

export const TEMPLATES: Record<string, Template> = {

  // ── 1. PDF Summarizer ──────────────────────────────────────────────────────
  pdf_summarizer: {
    name: 'PDF Summarizer',
    description: 'Extract, chunk, summarise and review a document',
    category: 'Documents',
    icon: '📄',
    nodes: [
      n('1', 'orchestrator', 'PDF Extractor',
        'Extract all text from state["input:pdf_path"]. Write raw text to state["extract:raw_text"]. Confirm extraction length.',
        300, 0),
      n('2', 'researcher', 'Section Chunker',
        'Read state["extract:raw_text"]. Split into logical sections (introduction, body, conclusion). Write to state["chunks:sections"] as a list.',
        100, 200),
      n('3', 'researcher', 'Key Points Extractor',
        'Read state["chunks:sections"]. Extract the 5 most important points. Write to state["summary:key_points"].',
        500, 200),
      n('4', 'coder', 'Summary Composer',
        'Read state["summary:key_points"] and state["chunks:sections"]. Write a 3-paragraph executive summary to state["compose:final"].',
        300, 400),
      n('5', 'reviewer', 'Quality Reviewer',
        'Read state["compose:final"]. Score quality 0-100. Write state["score"] and state["reviewer:approved"] (true if score >= 75). Write state["review:feedback"].',
        300, 600, 'claude-opus-4-5'),
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e2', source: '1', target: '3', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e3', source: '2', target: '4', style: { stroke: '#a1a1aa' } },
      { id: 'e4', source: '3', target: '4', style: { stroke: '#a1a1aa' } },
      { id: 'e5', source: '4', target: '5', style: { stroke: '#a1a1aa' } },
    ],
  },

  // ── 2. Multi-Agent Reasoning Loop ─────────────────────────────────────────
  reasoning_loop: {
    name: 'Multi-Agent Reasoning Loop',
    description: 'Debate, challenge and synthesise until quality threshold is met',
    category: 'Reasoning',
    icon: '🧠',
    nodes: [
      n('1', 'orchestrator', 'Debate Orchestrator',
        'Read state["input:question"]. Set state["orchestrator:focus"] and state["orchestrator:round"]. Determine what aspect to debate this round.',
        300, 0),
      n('2', 'researcher', 'Argument Proposer',
        'Read state["orchestrator:focus"]. Build the strongest argument supporting the main thesis. Write to state["proposer:position"].',
        100, 200),
      n('3', 'reviewer', "Devil's Advocate",
        'Read state["proposer:position"]. Challenge it rigorously with counter-arguments and evidence. Write to state["critic:challenges"].',
        500, 200),
      n('4', 'coder', 'Synthesis Agent',
        'Read state["proposer:position"] and state["critic:challenges"]. Write a balanced, nuanced conclusion to state["synthesiser:conclusion"].',
        300, 400),
      n('5', 'reviewer', 'Quality Validator',
        'Score state["synthesiser:conclusion"] 0-100. Write state["score"] and state["reviewer:approved"] (true if >= 80). Write state["validator:feedback"].',
        300, 600, 'claude-opus-4-5'),
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e2', source: '1', target: '3', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e3', source: '2', target: '4', style: { stroke: '#a1a1aa' } },
      { id: 'e4', source: '3', target: '4', style: { stroke: '#a1a1aa' } },
      { id: 'e5', source: '4', target: '5', style: { stroke: '#a1a1aa' } },
      {
        id: 'e6', source: '5', target: '1', animated: true,
        label: 'score < 80',
        style: { stroke: '#d97706', strokeWidth: 1.5, strokeDasharray: '6 3' },
        data: { condition: { expression: "state['score'] < 80", label: 'score < 80' } },
      },
    ],
  },

  // ── 3. API Data Analyzer ──────────────────────────────────────────────────
  api_analysis: {
    name: 'API Data Analyzer',
    description: 'Fetch live data, validate, analyse and produce a report',
    category: 'Data',
    icon: '📊',
    nodes: [
      n('1', 'orchestrator', 'Request Planner',
        'Read state["input:api_target"] and state["input:analysis_goal"]. Plan which endpoints to call. Write to state["plan:endpoints"] and state["plan:goals"].',
        300, 0),
      n('2', 'coder', 'API Fetcher',
        'Read state["plan:endpoints"]. Call each endpoint using api_fetch tool. Write responses to state["fetch:responses"].',
        300, 200, 'claude-sonnet-4-5', ['api_fetch', 'api_call']),
      n('3', 'researcher', 'Data Validator',
        'Read state["fetch:responses"]. Check schema consistency and data quality. Write clean data to state["validate:clean_data"] and issues to state["validate:issues"].',
        100, 400),
      n('4', 'researcher', 'Trend Analyst',
        'Read state["validate:clean_data"] and state["plan:goals"]. Identify patterns, trends and anomalies. Write to state["analysis:trends"].',
        500, 400),
      n('5', 'coder', 'Report Composer',
        'Read state["analysis:trends"] and state["validate:issues"]. Write a structured markdown report to state["report:markdown"].',
        300, 600),
      n('6', 'reviewer', 'Report Reviewer',
        'Read state["report:markdown"]. Score accuracy and clarity 0-100. Write state["score"] and state["reviewer:approved"].',
        300, 800, 'claude-opus-4-5'),
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e2', source: '2', target: '3', style: { stroke: '#a1a1aa' } },
      { id: 'e3', source: '2', target: '4', style: { stroke: '#a1a1aa' } },
      { id: 'e4', source: '3', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e5', source: '4', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e6', source: '5', target: '6', style: { stroke: '#a1a1aa' } },
    ],
  },

  // ── 4. Supplier Risk Analysis ─────────────────────────────────────────────
  supplier_risk: {
    name: 'Supplier Risk Analysis',
    description: 'Research, score and recommend action on supplier risk',
    category: 'Business',
    icon: '⚠️',
    nodes: [
      n('1', 'orchestrator', 'Risk Coordinator',
        'Read state["input:supplier_name"] and state["input:industry"]. Define risk dimensions to investigate. Write to state["plan:risk_dimensions"].',
        300, 0),
      n('2', 'researcher', 'Financial Researcher',
        'Read state["input:supplier_name"]. Research financial health, credit ratings and news. Write findings to state["research:financial"].',
        0, 200, 'claude-sonnet-4-5', ['api_fetch']),
      n('3', 'researcher', 'Operational Researcher',
        'Read state["input:supplier_name"] and state["plan:risk_dimensions"]. Assess operational risks, capacity, certifications. Write to state["research:operational"].',
        300, 200, 'claude-sonnet-4-5', ['api_fetch']),
      n('4', 'researcher', 'Compliance Researcher',
        'Research regulatory compliance, sanctions and legal issues for state["input:supplier_name"]. Write to state["research:compliance"].',
        600, 200, 'claude-haiku-4-5', ['api_fetch']),
      n('5', 'coder', 'Risk Scorer',
        'Read all state["research:*"] fields. Calculate a composite risk score 0-100 per dimension. Write to state["score:dimensions"] and state["score:overall"].',
        300, 400),
      n('6', 'reviewer', 'Risk Reviewer',
        'Read state["score:overall"] and state["score:dimensions"]. Write an executive risk assessment with state["risk:recommendation"] (approve/review/reject) and state["risk:summary"].',
        300, 600, 'claude-opus-4-5'),
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e2', source: '1', target: '3', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e3', source: '1', target: '4', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e4', source: '2', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e5', source: '3', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e6', source: '4', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e7', source: '5', target: '6', style: { stroke: '#a1a1aa' } },
    ],
  },

  // ── 5. Code Review Pipeline ───────────────────────────────────────────────
  code_review: {
    name: 'Code Review Pipeline',
    description: 'Security scan, style check, test coverage and PR summary',
    category: 'Engineering',
    icon: '🔍',
    nodes: [
      n('1', 'orchestrator', 'PR Coordinator',
        'Read state["input:pr_url"] and state["input:language"]. Coordinate review tasks. Write state["plan:checks"] listing what to review.',
        300, 0),
      n('2', 'coder', 'Security Auditor',
        'Read state["input:pr_url"]. Identify security vulnerabilities, injection risks, hardcoded secrets. Write issues to state["security:issues"] and state["security:severity"].',
        0, 200, 'claude-opus-4-5'),
      n('3', 'coder', 'Style Checker',
        'Review code style, naming conventions, documentation quality from state["input:pr_url"]. Write to state["style:violations"] and state["style:score"].',
        300, 200),
      n('4', 'researcher', 'Test Coverage Analyst',
        'Analyse test coverage and edge cases for state["input:pr_url"]. Write to state["tests:coverage_pct"] and state["tests:missing_cases"].',
        600, 200, 'claude-haiku-4-5'),
      n('5', 'reviewer', 'PR Summariser',
        'Read state["security:issues"], state["style:score"], state["tests:coverage_pct"]. Write state["review:verdict"] (approve/request-changes), state["review:summary"] and state["score"].',
        300, 400, 'claude-opus-4-5'),
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e2', source: '1', target: '3', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e3', source: '1', target: '4', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e4', source: '2', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e5', source: '3', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e6', source: '4', target: '5', style: { stroke: '#a1a1aa' } },
    ],
  },

  // ── 6. Research Report Writer ─────────────────────────────────────────────
  research_report: {
    name: 'Research Report Writer',
    description: 'Research a topic deeply and produce a structured report',
    category: 'Research',
    icon: '📝',
    nodes: [
      n('1', 'orchestrator', 'Research Director',
        'Read state["input:topic"]. Break into 3 research sub-questions. Write to state["plan:sub_questions"] and state["plan:format"].',
        300, 0),
      n('2', 'researcher', 'Primary Researcher',
        'Read state["plan:sub_questions"][0]. Research deeply using available tools. Write findings to state["research:primary"].',
        0, 200, 'claude-sonnet-4-5', ['api_fetch']),
      n('3', 'researcher', 'Secondary Researcher',
        'Read state["plan:sub_questions"][1]. Find supporting evidence and data. Write to state["research:secondary"].',
        300, 200, 'claude-sonnet-4-5', ['api_fetch']),
      n('4', 'researcher', 'Tertiary Researcher',
        'Read state["plan:sub_questions"][2]. Research counterarguments and limitations. Write to state["research:tertiary"].',
        600, 200, 'claude-haiku-4-5', ['api_fetch']),
      n('5', 'coder', 'Report Writer',
        'Read all state["research:*"] fields and state["plan:format"]. Write a structured report with sections to state["report:markdown"].',
        300, 400),
      n('6', 'reviewer', 'Editorial Reviewer',
        'Read state["report:markdown"]. Check accuracy, structure, citations. Write state["score"], state["reviewer:approved"] and state["review:edits"].',
        300, 600, 'claude-opus-4-5'),
    ],
    edges: [
      { id: 'e1', source: '1', target: '2', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e2', source: '1', target: '3', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e3', source: '1', target: '4', animated: true, style: { stroke: '#a1a1aa' } },
      { id: 'e4', source: '2', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e5', source: '3', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e6', source: '4', target: '5', style: { stroke: '#a1a1aa' } },
      { id: 'e7', source: '5', target: '6', style: { stroke: '#a1a1aa' } },
    ],
  },
}
