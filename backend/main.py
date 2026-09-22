from typing import Any, Dict, List

import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Chum Buddies")

class Message(BaseModel):
    text: str
    target_lang: str

class MatchRequest(BaseModel):
    target_user: Dict[str, Any]
    all_users: List[Dict[str, Any]]

origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"], 
    allow_headers=["*"], 
)

def calculate_jaccard(list1, list2):
    set1 = set(list1) if list1 else set()
    set2 = set(list2) if list2 else set()
    
    shared_items = len(set1.intersection(set2))
    total_unique_items = len(set1.union(set2))
    
    if total_unique_items == 0:
        return 0.0
    return shared_items / total_unique_items

def get_matches(target_user, all_users):
    scored_matches = []

    for user in all_users:
        if user.get("id") == target_user.get("id"):
            continue

        score = 0.0
        score += calculate_jaccard(target_user.get("interests"), user.get("interests")) * 0.4
        score += calculate_jaccard(target_user.get("societies"), user.get("societies")) * 0.3
        score += calculate_jaccard(target_user.get("languages"), user.get("languages")) * 0.1

        target_degree = target_user.get("degree", "").lower().strip()
        user_degree = user.get("degree", "").lower().strip()
        if target_degree and user_degree and target_degree == user_degree:
            score += 0.2

        final_score = min(score, 1.0)
        user_data = user.copy()
        user_data["match_score"] = round(final_score, 2)
        scored_matches.append(user_data)

    return sorted(scored_matches, key=lambda item: item.get("match_score", 0), reverse=True)

@app.post("/api/match")
async def match_users(request: MatchRequest):
    matches = get_matches(request.target_user, request.all_users)
    return {"matches": matches}

@app.post("/api/translate")
async def translate_text_endpoint(payload: Message):
    original_text = payload.text
    target_lang = payload.target_lang
    
    if not original_text or not target_lang:
        return {"translated": original_text}

    try:
        url = f"https://api.mymemory.translated.net/get?q={requests.utils.quote(original_text)}&langpair=en|{target_lang}"
        r = requests.get(url)
        data = r.json()
        translated_text = data.get("responseData", {}).get("translatedText", original_text)
        
        # Guard against MyMemory spam/error tokens
        if not translated_text or "TESTVALUE" in translated_text.upper():
            return {"original": original_text, "translated": original_text}
            
        return {"original": original_text, "translated": translated_text}
    except Exception as e:
        return {"original": original_text, "translated": original_text, "error": str(e)}

app = FastAPI(title="Chum Buddies")

@app.get("/")
def home():
    return {"status": "Chum Buddies backend is running"}

class Message(BaseModel):
    text: str
    target_lang: str