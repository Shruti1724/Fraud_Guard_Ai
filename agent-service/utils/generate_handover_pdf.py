import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    """Two-pass canvas to dynamically compute and print 'Page X of Y'."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#475569"))
        
        # Header (pages 1 and 2)
        self.drawString(36, 11 * 72 - 25, "FRAUDGUARD AI — INVESTIGATION LAYER 3 HANDOVER")
        self.setFont("Helvetica", 8)
        self.drawRightString(8.5 * 72 - 36, 11 * 72 - 25, "CONFIDENTIAL // TECHNICAL HANDOVER FOR MEMBER A")
        self.setStrokeColor(colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.75)
        self.line(36, 11 * 72 - 28, 8.5 * 72 - 36, 11 * 72 - 28)
        
        # Footer
        self.line(36, 30, 8.5 * 72 - 36, 30)
        self.drawString(36, 20, "FraudGuard AI Autonomous Multi-Agent Pipeline | Member C (Shruti Jaggi) → Member A")
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(8.5 * 72 - 36, 20, page_str)
        self.restoreState()

def build_pdf(filename="FraudGuard_AI_Handover_Member_A.pdf"):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette
    NAVY = colors.HexColor("#0F172A")
    BLUE = colors.HexColor("#1E40AF")
    SLATE = colors.HexColor("#334155")
    MUTED = colors.HexColor("#64748B")
    BG_LIGHT = colors.HexColor("#F8FAFC")
    BORDER_LIGHT = colors.HexColor("#E2E8F0")
    ALERT_RED_BG = colors.HexColor("#FEF2F2")
    ALERT_RED_TXT = colors.HexColor("#991B1B")
    SUCCESS_GREEN_BG = colors.HexColor("#F0FDF4")
    SUCCESS_GREEN_TXT = colors.HexColor("#166534")

    # Typography Styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=17,
        leading=21,
        textColor=NAVY
    )
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13,
        textColor=SLATE
    )
    sec_heading = ParagraphStyle(
        'SectionHeading',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=14,
        textColor=BLUE,
        spaceAfter=3
    )
    body = ParagraphStyle(
        'Body',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.2,
        leading=11.2,
        textColor=SLATE
    )
    body_bold = ParagraphStyle(
        'BodyBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.2,
        leading=11.2,
        textColor=NAVY
    )
    badge_label = ParagraphStyle(
        'BadgeLabel',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=7.2,
        leading=9.5,
        textColor=MUTED
    )
    badge_val = ParagraphStyle(
        'BadgeVal',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10.5,
        textColor=NAVY
    )
    table_cell = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=7.6,
        leading=10,
        textColor=SLATE
    )
    table_cell_bold = ParagraphStyle(
        'TableCellBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=7.6,
        leading=10,
        textColor=NAVY
    )
    table_cell_code = ParagraphStyle(
        'TableCellCode',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=7.2,
        leading=9.5,
        textColor=BLUE
    )

    story = []

    # =========================================================================
    # PAGE 1
    # =========================================================================
    
    # Header Banner
    story.append(Paragraph("FraudGuard AI — Handover Document for Member A", title_style))
    story.append(Spacer(1, 2))
    story.append(Paragraph("Layer 3: Autonomous Multi-Agent Investigation Pipeline (Architecture, Execution Flow & Integration)", subtitle_style))
    story.append(Spacer(1, 6))

    # Metadata Cards Table
    meta_data = [
        [
            Paragraph("ROLE / AUTHOR", badge_label),
            Paragraph("TARGET RECIPIENT", badge_label),
            Paragraph("SERVICE PORT / PROTOCOL", badge_label),
            Paragraph("LLM RUNTIME / STATUS", badge_label)
        ],
        [
            Paragraph("Member C (Shruti Jaggi)", badge_val),
            Paragraph("Member A (UI / App Backend)", badge_val),
            Paragraph("Port 8001 / HTTP & ASGI", badge_val),
            Paragraph("Ollama llama3.2 / Operational", badge_val)
        ]
    ]
    meta_table = Table(meta_data, colWidths=[135, 135, 135, 135])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BG_LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.75, BORDER_LIGHT),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_LIGHT),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 8))

    # Section 1: Executive Overview
    story.append(Paragraph("1. Executive Overview & Scope Delivered", sec_heading))
    story.append(Paragraph(
        "Member C has built and delivered the <b>Layer 3 Agentic Investigation Layer</b> for FraudGuard AI. While Member A operates "
        "the mock UPI client (Layer 1) and Member B maintains the GraphSAGE + XGBoost scoring engine (Layer 2), Member C's service "
        "provides the <b>autonomous multi-agent reasoning core</b>. When an account exceeds the operational risk threshold (blended score "
        "&ge; 0.85), this pipeline is triggered to gather multi-hop graph context, determine whether the pattern is a genuine fraud ring or an "
        "innocent decoy, enforce account freezes/clearances, and synthesize court-admissible forensic audit reports. Live benchmarking reveals "
        "a <b>13.12-second median flag-to-decision latency</b> (over <b>114&times; faster</b> than the 20–30 minute human analyst baseline).",
        body
    ))
    story.append(Spacer(1, 8))

    # Section 2: Detailed Breakdown of the 4 Autonomous Agents
    story.append(Paragraph("2. Detailed Breakdown of the 4 Autonomous Agents", sec_heading))
    
    agent_data = [
        [
            Paragraph("Agent & File", table_cell_bold),
            Paragraph("Forensic Core Responsibilities", table_cell_bold),
            Paragraph("Decisions & Output Signals", table_cell_bold)
        ],
        [
            Paragraph("<b>1. Investigator Agent</b><br/><font color='#1E40AF'>nodes/investigator.py</font>", table_cell),
            Paragraph(
                "&bull; Analyzes account age, KYC tier, transaction velocity, retained balance, and 2-hop transaction neighbors.<br/>"
                "&bull; <b>Discrimination Engine</b>: Distinguishes genuine fraud rings (<i>mule-chain, star-burst smurfing, cyclic wash trading, fan-out</i>) "
                "from innocent look-alike decoys (<i>family group, forwarding chain, merchant hub, payroll fanout</i>).<br/>"
                "&bull; <b>Model Divergence Analysis</b>: Identifies structural over-flags where GraphSAGE (&ge; 0.85) elevated an account due to graph "
                "proximity while tabular XGBoost (&lt; 0.30) and tenure indicate an innocent false-positive.",
                table_cell
            ),
            Paragraph("Outputs: <font face='Courier'>suspicion_score</font> (0–100), <font face='Courier'>risk_level</font> (LOW/CRITICAL), topology booleans, <font face='Courier'>innocent_lookalike_detected</font>, and structured evidence trail.", table_cell)
        ],
        [
            Paragraph("<b>2. Decision Agent</b><br/><font color='#1E40AF'>nodes/decision.py</font>", table_cell),
            Paragraph(
                "&bull; <b>Stage 1 (Hard Business Rules Pre-Filter)</b>: Deterministic NPCI compliance enforcement. Auto-blocks confirmed mule-chains "
                "with rapid pass-through and near-zero retained balance; instantly clears verified decoys with tenure &gt; 90 days and full biometric KYC.<br/>"
                "&bull; <b>Stage 2 (LLM Forensic Judgment)</b>: Invokes local Ollama (<font face='Courier'>llama3.2:latest</font>) to evaluate ambiguous "
                "borderline cases where precision at threshold is ~0.43.<br/>"
                "&bull; <b>Safety Guard</b>: Rule 3 (<font face='Courier'>BENIGN_BASELINE</font>) is strictly forbidden from clearing accounts with risk score &ge; 0.70 or victim/sink links.",
                table_cell
            ),
            Paragraph("Enforces one of 3 verdicts:<br/><b>1. auto_block</b><br/><b>2. escalate</b><br/><b>3. clear</b><br/>with confidence score & policy rationale.", table_cell)
        ],
        [
            Paragraph("<b>3. Action Agent</b><br/><font color='#1E40AF'>nodes/action.py</font>", table_cell),
            Paragraph(
                "&bull; <b>Pluggable Backends</b>: Operates in <font face='Courier'>SimulatedActionBackend</font> (safe local runs) or <font face='Courier'>MongoActionBackend</font> "
                "(direct persistence to MongoDB <font face='Courier'>InvestigationCase</font> and <font face='Courier'>AuditAction</font>).<br/>"
                "&bull; <b>Action State Mapping</b>: Maps <font face='Courier'>auto_block</font> &rarr; <font face='Courier'>account_frozen</font> (revokes UPI handle, applies NPCI debit freeze, "
                "blacklists device ID); <font face='Courier'>escalate</font> &rarr; <font face='Courier'>flagged_for_review</font> (30-min hold, step-up OTP); <font face='Courier'>clear</font> &rarr; <font face='Courier'>cleared</font>.<br/>"
                "&bull; <b>Score Invariance</b>: Never modifies Member B's precomputed ML scores.",
                table_cell
            ),
            Paragraph("Executes automated regulatory countermeasures, updates account status, and produces verified action summary strings.", table_cell)
        ],
        [
            Paragraph("<b>4. Report Agent</b><br/><font color='#1E40AF'>nodes/report.py</font>", table_cell),
            Paragraph(
                "&bull; Synthesizes executive, court-admissible forensic case audit reports detailing target account, KYC status, model score breakdown "
                "(Blended / XGBoost / GraphSAGE), detected topological patterns, forensic evidence trail, and policy rationales.<br/>"
                "&bull; Appends standardized ISO 8601 audit timestamps and seals report with compliance metadata.",
                table_cell
            ),
            Paragraph("Returns sealed human-readable audit text formatted for both compliance logs and Member A's UI dashboard.", table_cell)
        ]
    ]
    agent_table = Table(agent_data, colWidths=[105, 305, 130])
    agent_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BG_LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.75, BORDER_LIGHT),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_LIGHT),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(agent_table)
    story.append(Spacer(1, 8))

    # Section 3: End-to-End Investigation Flow
    story.append(Paragraph("3. End-to-End Multi-Agent Pipeline Workflow", sec_heading))
    
    flow_data = [
        [
            Paragraph("Trigger Event", table_cell_bold),
            Paragraph("Data Hydration", table_cell_bold),
            Paragraph("Agent 1: Investigate", table_cell_bold),
            Paragraph("Agent 2: Decide", table_cell_bold),
            Paragraph("Agent 3: Act", table_cell_bold),
            Paragraph("Agent 4: Report", table_cell_bold)
        ],
        [
            Paragraph("Layer 2 model score &ge; 0.85 or UI manual challenge", table_cell),
            Paragraph("Loads 893k profiles & 519k edges from CSV/Mongo", table_cell),
            Paragraph("Discovers rings vs look-alikes; scores risk", table_cell),
            Paragraph("NPCI rules pre-filter + Ollama LLM judgment", table_cell),
            Paragraph("Freezes account, revokes VPA, blacklists device", table_cell),
            Paragraph("Generates sealed forensic report for dashboard", table_cell)
        ]
    ]
    flow_table = Table(flow_data, colWidths=[90, 90, 90, 90, 90, 90])
    flow_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BG_LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.75, BORDER_LIGHT),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_LIGHT),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(flow_table)

    # Force PageBreak to guarantee exact 2-page constraint
    story.append(PageBreak())

    # =========================================================================
    # PAGE 2
    # =========================================================================
    story.append(Paragraph("4. Technology Stack Delivered", sec_heading))
    
    tech_data = [
        [Paragraph("Component", table_cell_bold), Paragraph("Technology & Version", table_cell_bold), Paragraph("Architectural Rationale & Implementation Details", table_cell_bold)],
        [Paragraph("Web Service Core", table_cell), Paragraph("FastAPI (ASGI) / Uvicorn", table_cell_code), Paragraph("Async non-blocking REST endpoints, OpenAPI documentation at <font face='Courier'>/docs</font>, strict port 8001.", table_cell)],
        [Paragraph("Agentic Framework", table_cell), Paragraph("LangGraph 0.2+ / LangChain", table_cell_code), Paragraph("Stateful DAG multi-agent execution pipeline passing validated <font face='Courier'>InvestigationState</font> dictionaries.", table_cell)],
        [Paragraph("Reasoning Engine", table_cell), Paragraph("Ollama / llama3.2:latest", table_cell_code), Paragraph("Local 3.2B parameter LLM execution. 100% private, zero external cloud costs or API rate limits.", table_cell)],
        [Paragraph("Schema Validation", table_cell), Paragraph("Pydantic v2", table_cell_code), Paragraph("Strict input/output JSON schema enforcement, JSON Schema structured output extraction from Ollama.", table_cell)],
        [Paragraph("Data Provider Engine", table_cell), Paragraph("Dual-Mode CsvProvider & Mock", table_cell_code), Paragraph("Fast in-memory index over 893,216 account profiles and 519,454 transaction edges with sub-second lookups.", table_cell)],
        [Paragraph("Persistence Layer", table_cell), Paragraph("MongoDB / PyMongo 4.0+", table_cell_code), Paragraph("Direct persistence into <font face='Courier'>InvestigationCase</font> and <font face='Courier'>AuditAction</font> collections.", table_cell)],
        [Paragraph("Test & Quality Suite", table_cell), Paragraph("Pytest 9.0+ / Starlette TestClient", table_cell_code), Paragraph("26 automated tests covering contract shapes, thresholds, fallback caching, and business logic.", table_cell)]
    ]
    tech_table = Table(tech_data, colWidths=[95, 135, 310])
    tech_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BG_LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.75, BORDER_LIGHT),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_LIGHT),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(tech_table)
    story.append(Spacer(1, 8))

    # Section 5: API Contract Specifications (Contract 4.1)
    story.append(Paragraph("5. API Contract Specifications for Member A (Contract 4.1)", sec_heading))
    story.append(Paragraph(
        "Member A's backend (<font face='Courier'>backend/services/agentServiceClient.js</font>) interacts with Layer 3 via a single, "
        "strongly-typed endpoint. The service guarantees <b>strict contract compliance</b>:",
        body
    ))
    story.append(Spacer(1, 4))

    contract_data = [
        [
            Paragraph("<b>HTTP Method & Path</b>: <font face='Courier'>POST http://127.0.0.1:8001/investigate</font><br/>"
                      "<b>Query Parameter</b>: <font face='Courier'>?use_cache=true</font> (instant pre-cached response for live demo presentations)<br/>"
                      "<b>Request Body Schema</b>: <font face='Courier'>{\"account_id\": \"C1000039615\"}</font> (strips '@upi' and normalizes case)<br/>"
                      "<b>Error Codes</b>: <font face='Courier'>404 Not Found</font> for unknown accounts; <font face='Courier'>422 Unprocessable</font> for empty ID. <i>Never returns 500 on bad IDs.</i>", table_cell),
            Paragraph("<b>Success Response Body (200 OK)</b>:<br/>"
                      "<font face='Courier' color='#1E40AF'>{\n"
                      "  \"account_id\": \"C1000039615\",\n"
                      "  \"decision\": \"auto_block\",\n"
                      "  \"action_taken\": \"UPI ID 'c1000039615@upi' revoked; Immediate debit freeze applied on NPCI switch...\",\n"
                      "  \"report\": \"=== FRAUDGUARD AI CASE AUDIT REPORT ===\\nTarget Account: C1000039615...\"\n"
                      "}</font>", table_cell)
        ]
    ]
    contract_table = Table(contract_data, colWidths=[270, 270])
    contract_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BG_LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.75, BORDER_LIGHT),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_LIGHT),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(contract_table)
    story.append(Spacer(1, 8))

    # Section 6: Action Items & Integration Guide for Member A
    story.append(Paragraph("6. Required Action Items & Integration Checklist for Member A", sec_heading))
    
    checklist_data = [
        [
            Paragraph("Item", table_cell_bold),
            Paragraph("Area in Member A Codebase", table_cell_bold),
            Paragraph("Required Implementation / Action", table_cell_bold),
            Paragraph("Status", table_cell_bold)
        ],
        [
            Paragraph("1. Client Timeout", table_cell),
            Paragraph("<font face='Courier'>backend/services/agentServiceClient.js</font>", table_cell),
            Paragraph("Configure fetch timeout to <b>&ge; 25–30 seconds</b> to allow complete local Ollama LLM reasoning without premature timeouts.", table_cell),
            Paragraph("<font color='#B45309'><b>Action Req.</b></font>", table_cell)
        ],
        [
            Paragraph("2. Payment Freeze Enforcement", table_cell),
            Paragraph("<font face='Courier'>backend/routes/sendMoney.js</font>", table_cell),
            Paragraph("When recipient account has <font face='Courier'>status === 'account_frozen'</font>, immediately reject transaction with debit freeze notification.", table_cell),
            Paragraph("<font color='#B45309'><b>Action Req.</b></font>", table_cell)
        ],
        [
            Paragraph("3. Socket.IO Live Feed", table_cell),
            Paragraph("<font face='Courier'>frontend/src/components/AgentFeed.jsx</font>", table_cell),
            Paragraph("Ensure UI listens to <font face='Courier'>io.emit('agent:activity')</font> to display real-time case reports and decision badges (Red/Amber/Green).", table_cell),
            Paragraph("<font color='#166534'><b>Supported</b></font>", table_cell)
        ],
        [
            Paragraph("4. Account Status Enum", table_cell),
            Paragraph("<font face='Courier'>backend/models/Account.js</font>", table_cell),
            Paragraph("Standardized status strings: <font face='Courier'>account_frozen</font> (auto_block), <font face='Courier'>flagged_for_review</font> (escalate), <font face='Courier'>cleared</font> (clear).", table_cell),
            Paragraph("<font color='#166534'><b>Aligned</b></font>", table_cell)
        ],
        [
            Paragraph("5. Demo Presentation IDs", table_cell),
            Paragraph("Mock UPI App Pre-set Dropdown", table_cell),
            Paragraph("<b>Mule Ring</b>: <font face='Courier'>C1000039615</font> (auto_block). <b>Innocent Decoy</b>: <font face='Courier'>acc_decoy_family_01</font> (resolved as clear false-alarm).", table_cell),
            Paragraph("<font color='#166534'><b>Verified</b></font>", table_cell)
        ]
    ]
    checklist_table = Table(checklist_data, colWidths=[80, 150, 240, 70])
    checklist_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BG_LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.75, BORDER_LIGHT),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_LIGHT),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(checklist_table)
    story.append(Spacer(1, 8))

    # Section 7: Verification & Sign-Off Banner
    story.append(Paragraph("7. Quality Assurance & Sign-off", sec_heading))
    story.append(Paragraph(
        "<b>Verification Complete</b>: 26 of 26 automated regression tests are passing (<font face='Courier'>pytest agent-service/test_pipeline.py</font>). "
        "The service runs continuously on <font face='Courier'>http://127.0.0.1:8001</font> with live CSV data ingestion active across all 893,216 dataset accounts. "
        "For interactive exploration, open the interactive Swagger UI documentation at <b>http://127.0.0.1:8001/docs</b>.",
        body
    ))

    # Build Document
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF successfully generated: {filename}")

if __name__ == "__main__":
    build_pdf()
