import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from langgraph.graph import StateGraph, START, END
from state import InvestigationState
from nodes.investigator import investigator_node
from nodes.decision import decision_node
from nodes.action import action_node
from nodes.report import report_node

def build_investigation_graph():
    """Builds and compiles the sequential 4-agent LangGraph pipeline:
    START -> investigator -> decision -> action -> report -> END
    """
    workflow = StateGraph(InvestigationState)
    
    # 1. Add Agent Nodes
    workflow.add_node("investigator", investigator_node)
    workflow.add_node("decision", decision_node)
    workflow.add_node("action", action_node)
    workflow.add_node("report", report_node)
    
    # 2. Add Edges in Sequence
    workflow.add_edge(START, "investigator")
    workflow.add_edge("investigator", "decision")
    workflow.add_edge("decision", "action")
    workflow.add_edge("action", "report")
    workflow.add_edge("report", END)
    
    return workflow.compile()

# Global compiled graph instance
investigation_pipeline = build_investigation_graph()
