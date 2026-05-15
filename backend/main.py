import os
import json
import asyncio
from typing import Dict, Any, List, TypedDict
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
from langgraph.graph import StateGraph, END

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from dotenv import load_dotenv

load_dotenv()

# We'll initialize the LLM here. Make sure GOOGLE_API_KEY is in your environment or .env file.
llm = ChatGoogleGenerativeAI(model="gemini-3.1-pro-preview", temperature=0)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dummy Transactions
TRANSACTIONS = {
    "TXN1001": {
        "id": "TXN1001",
        "amount": 15000,
        "currency": "USD",
        "merchant": "Global Electronics Inc",
        "location": "Moscow, RU",
        "user_id": "U1234",
        "user_country": "US",
        "time": "02:30 AM",
        "is_international": True,
        "category": "Electronics",
        "note": "Large purchase at unusual hour from foreign country",
    },
    "TXN1002": {
        "id": "TXN1002",
        "amount": 25,
        "currency": "USD",
        "merchant": "Local Coffee Shop",
        "location": "New York, US",
        "user_id": "U5678",
        "user_country": "US",
        "time": "08:15 AM",
        "is_international": False,
        "category": "Food & Beverage",
        "note": "Routine low-value domestic transaction",
    },
    "TXN1003": {
        "id": "TXN1003",
        "amount": 4999,
        "currency": "EUR",
        "merchant": "Luxury Watches Ltd",
        "location": "Paris, FR",
        "user_id": "U9012",
        "user_country": "UK",
        "time": "14:45 PM",
        "is_international": True,
        "category": "Luxury Goods",
        "note": "High-value luxury purchase, cross-border EU transaction",
    },
    "TXN1004": {
        "id": "TXN1004",
        "amount": 9800,
        "currency": "USD",
        "merchant": "CryptoSwap Exchange",
        "location": "Online",
        "user_id": "U3344",
        "user_country": "US",
        "time": "03:12 AM",
        "is_international": False,
        "category": "Cryptocurrency",
        "note": "Large crypto purchase at 3 AM on a new device, first-ever crypto transaction for this user",
    },
    "TXN1005": {
        "id": "TXN1005",
        "amount": 120,
        "currency": "USD",
        "merchant": "QuickMart Online",
        "location": "Chicago, US",
        "user_id": "U7788",
        "user_country": "US",
        "time": "11:30 AM",
        "is_international": False,
        "category": "E-commerce",
        "note": "Card-not-present transaction; 6 similar transactions in last 2 hours from different IPs",
    },
    "TXN1006": {
        "id": "TXN1006",
        "amount": 49500,
        "currency": "USD",
        "merchant": "First National Wire Transfer",
        "location": "Dubai, AE",
        "user_id": "U2211",
        "user_country": "US",
        "time": "09:05 AM",
        "is_international": True,
        "category": "Wire Transfer",
        "note": "Near-threshold wire transfer to UAE, user profile normally has transactions under $5000",
    },
    "TXN1007": {
        "id": "TXN1007",
        "amount": 250,
        "currency": "GBP",
        "merchant": "TechGadgets UK",
        "location": "London, UK",
        "user_id": "U6655",
        "user_country": "US",
        "time": "16:20 PM",
        "is_international": True,
        "category": "Electronics",
        "note": "User is in US; simultaneous transaction flagged in New York 4 minutes ago",
    },
    "TXN1008": {
        "id": "TXN1008",
        "amount": 3,
        "currency": "USD",
        "merchant": "StreamFlix Monthly",
        "location": "San Francisco, US",
        "user_id": "U4499",
        "user_country": "US",
        "time": "13:00 PM",
        "is_international": False,
        "category": "Subscription",
        "note": "Routine recurring subscription; no risk indicators",
    },
}

class AgentState(TypedDict):
    transaction: Dict[str, Any]
    analyzer_output: str
    scorer_output: str
    advisor_output: str

async def analyzer_node(state: AgentState):
    txn = state["transaction"]
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an expert fraud investigation analyzer. Analyze the transaction details and identify any potential fraud flags (e.g. high amounts, location mismatches, unusual times). If none, state that no obvious flags were detected. Output a bulleted list of flags."),
        ("user", "Transaction details:\n{txn}")
    ])
    
    chain = prompt | llm | StrOutputParser()
    result = await chain.ainvoke({"txn": json.dumps(txn, indent=2)})
    
    return {"analyzer_output": f"Analyzer Flags:\n{result}"}

async def scorer_node(state: AgentState):
    flags = state["analyzer_output"]
    
    # Mock external data that would typically come from other DBs
    ext_data = "External System: User login was from a new device."
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a fraud scoring agent. Given the analyzer's flags and external system data, provide a fraud score from 0 to 100, and a brief justification. Output format MUST start with 'Fraud Score: X/100.' followed by your justification."),
        ("user", "Analyzer Flags:\n{flags}\n\nExternal Data:\n{ext_data}")
    ])
    
    chain = prompt | llm | StrOutputParser()
    result = await chain.ainvoke({"flags": flags, "ext_data": ext_data})
    
    return {"scorer_output": result}

async def advisor_node(state: AgentState):
    score_output = state["scorer_output"]
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a fraud investigation advisor. Review the fraud score and justification, and provide a final report and next steps for the investigator based on standard anti-fraud policies. \n\nOutput format:\nReport: [Your detailed report]\nNext Steps:\n1. [Step 1]\n2. [Step 2]..."),
        ("user", "Scorer Output:\n{score_output}")
    ])
    
    chain = prompt | llm | StrOutputParser()
    result = await chain.ainvoke({"score_output": score_output})
    
    return {"advisor_output": result}

# Build the LangGraph
workflow = StateGraph(AgentState)
workflow.add_node("analyzer", analyzer_node)
workflow.add_node("scorer", scorer_node)
workflow.add_node("advisor", advisor_node)

workflow.set_entry_point("analyzer")
workflow.add_edge("analyzer", "scorer")
workflow.add_edge("scorer", "advisor")
workflow.add_edge("advisor", END)

app_graph = workflow.compile()

@app.get("/api/transactions")
async def get_transactions():
    return list(TRANSACTIONS.values())

@app.get("/api/stream_investigation/{transaction_id}")
async def stream_investigation(transaction_id: str):
    if transaction_id not in TRANSACTIONS:
        return {"error": "Transaction not found"}

    txn = TRANSACTIONS[transaction_id]

    async def event_generator():
        yield {"data": json.dumps({"agent": "System", "status": "started", "message": f"Starting investigation for {transaction_id}"})}

        # ── Analyzer ──────────────────────────────────────────────────────
        yield {"data": json.dumps({"agent": "Analyzer", "status": "processing", "message": "Scanning transaction for fraud indicators..."})}

        analyzer_prompt = ChatPromptTemplate.from_messages([
            ("system", "You are an expert fraud investigation analyzer. Analyze the transaction details and identify any potential fraud flags (e.g. high amounts, location mismatches, unusual times). If none, state that no obvious flags were detected. Output a bulleted list of flags."),
            ("user", "Transaction details:\n{txn}")
        ])
        analyzer_chain = analyzer_prompt | llm | StrOutputParser()

        analyzer_output = ""
        async for token in analyzer_chain.astream({"txn": json.dumps(txn, indent=2)}):
            analyzer_output += token
            yield {"data": json.dumps({"agent": "Analyzer", "status": "thinking", "token": token})}

        yield {"data": json.dumps({"agent": "Analyzer", "status": "completed", "output": f"Analyzer Flags:\n{analyzer_output}"})}

        # ── Scorer ────────────────────────────────────────────────────────
        yield {"data": json.dumps({"agent": "Scorer", "status": "processing", "message": "Scoring transaction and fetching external data..."})}

        ext_data = "External System: User login was from a new device."
        scorer_prompt = ChatPromptTemplate.from_messages([
            ("system", "You are a fraud scoring agent. Given the analyzer's flags and external system data, provide a fraud score from 0 to 100, and a brief justification. Output format MUST start with 'Fraud Score: X/100.' followed by your justification."),
            ("user", "Analyzer Flags:\n{flags}\n\nExternal Data:\n{ext_data}")
        ])
        scorer_chain = scorer_prompt | llm | StrOutputParser()

        scorer_output = ""
        async for token in scorer_chain.astream({"flags": f"Analyzer Flags:\n{analyzer_output}", "ext_data": ext_data}):
            scorer_output += token
            yield {"data": json.dumps({"agent": "Scorer", "status": "thinking", "token": token})}

        yield {"data": json.dumps({"agent": "Scorer", "status": "completed", "output": scorer_output})}

        # ── Advisor ───────────────────────────────────────────────────────
        yield {"data": json.dumps({"agent": "Advisor", "status": "processing", "message": "Reviewing policies and generating final report..."})}

        advisor_prompt = ChatPromptTemplate.from_messages([
            ("system", "You are a fraud investigation advisor. Review the fraud score and justification, and provide a final report and next steps for the investigator based on standard anti-fraud policies.\n\nOutput format:\nReport: [Your detailed report]\nNext Steps:\n1. [Step 1]\n2. [Step 2]..."),
            ("user", "Scorer Output:\n{score_output}")
        ])
        advisor_chain = advisor_prompt | llm | StrOutputParser()

        advisor_output = ""
        async for token in advisor_chain.astream({"score_output": scorer_output}):
            advisor_output += token
            yield {"data": json.dumps({"agent": "Advisor", "status": "thinking", "token": token})}

        yield {"data": json.dumps({"agent": "Advisor", "status": "completed", "output": advisor_output})}

        yield {"data": json.dumps({"agent": "System", "status": "finished", "message": "Investigation complete."})}

    return EventSourceResponse(event_generator())

