#!/usr/bin/env python3
"""개발·평가 세트의 관련 문단 정답(gold)을 쓴다. 실행기는 이 파일과 *-gold.json을 읽지 않는다.
실행: python3 -I build-gold.py → dev-gold.json, eval-gold.json
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFINITION = (
    "관련 문단(gold): 기준 문단과 다른 문서에 있으면서, 같은 질문·같은 종류의 경험·같은 구체 주제(문단의 중심 논점)를 "
    "다른 표현으로 다룬 문단. 같은 넓은 분야(예: 둘 다 운동, 둘 다 책)에 속하거나 단어가 겹칠 뿐인 문단은 관련이 아니다. "
    "같은 문서의 문단과 정규화 본문이 같은 복제는 후보에서 제외하므로 gold가 될 수 없다. "
    "관련 문단이 없는 기준 문단(unrelated seed): 그 중심 논점을 다루는 다른 문서 문단이 이 세트에 없는 문단."
)


def write(name, related, unrelated):
    seeds = [{"seed": seed, "related": targets, "type": kind} for seed, targets, kind in related]
    data = {
        "schemaVersion": 1,
        "set": name,
        "definition": DEFINITION,
        "paragraphRule": "'문서 id:번호' — 빈 줄로 나눈 문단의 0부터 센 번호",
        "relatedSeeds": seeds,
        "unrelatedSeeds": unrelated,
        "counts": {
            "relatedSeeds": len(seeds),
            "goldPairs": sum(len(seed["related"]) for seed in seeds),
            "unrelatedSeeds": len(unrelated),
        },
        "labeler": "말뭉치를 쓴 구현 작업자 1인이 함께 표시했다. 독립 표시자는 없다.",
    }
    (HERE / f"{name}-gold.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(name, data["counts"])


DEV_RELATED = [
    ("D01:1", ["D02:0", "D02:1"], "experience"),
    ("D03:1", ["D04:0", "D04:1"], "question"),
    ("D03:4", ["D04:2"], "topic"),
    ("D05:1", ["D06:1"], "experience"),
    ("D05:2", ["D06:2"], "topic"),
    ("D05:3", ["D06:0"], "experience"),
    ("D07:0", ["D08:0"], "experience"),
    ("D07:1", ["D08:1"], "question"),
    ("D07:2", ["D08:3"], "question"),
    ("D07:3", ["D08:2"], "experience"),
    ("D09:1", ["D10:2"], "topic"),
    ("D09:2", ["D10:0"], "experience"),
    ("D09:3", ["D10:1"], "topic"),
    ("D12:0", ["D13:0"], "experience"),
    ("D12:1", ["D13:1"], "experience"),
    ("D12:2", ["D13:2"], "topic"),
]
DEV_UNRELATED = ["D01:2", "D01:3", "D01:4", "D09:4", "D11:0", "D11:1", "D11:3", "D12:3", "D14:0", "D14:1"]

EVAL_RELATED = [
    ("E01:1", ["E02:1", "E02:2"], "question"),
    ("E01:2", ["E25:2"], "experience"),
    ("E01:3", ["E13:4"], "question"),
    ("E01:4", ["E03:3"], "experience"),
    ("E03:1", ["E04:1"], "experience"),
    ("E03:2", ["E26:2", "E04:4"], "experience"),
    ("E03:4", ["E25:3"], "experience"),
    ("E04:4", ["E26:2", "E03:2"], "topic"),
    ("E25:1", ["E26:1"], "experience"),
    ("E26:3", ["E15:3"], "topic"),
    ("E05:1", ["E06:2", "E07:3"], "topic"),
    ("E05:2", ["E16:3"], "experience"),
    ("E05:4", ["E06:1"], "experience"),
    ("E06:3", ["E20:2"], "experience"),
    ("E08:2", ["E09:1"], "experience"),
    ("E08:3", ["E09:2"], "experience"),
    ("E08:4", ["E18:4"], "question"),
    ("E18:1", ["E19:1"], "topic"),
    ("E18:2", ["E19:2"], "experience"),
    ("E18:3", ["E19:3"], "topic"),
    ("E10:1", ["E11:2"], "topic"),
    ("E10:3", ["E11:3"], "experience"),
    ("E12:1", ["E13:1"], "experience"),
    ("E12:2", ["E13:3"], "experience"),
    ("E12:3", ["E01:2"], "experience"),
    ("E14:1", ["E15:1"], "experience"),
    ("E14:2", ["E21:2"], "experience"),
    ("E14:3", ["E15:2"], "topic"),
    ("E15:4", ["E20:1"], "experience"),
    ("E20:1", ["E21:3"], "topic"),
    ("E16:1", ["E17:1"], "experience"),
    ("E16:2", ["E22:2"], "experience"),
    ("E16:4", ["E17:3"], "experience"),
    ("E23:0", ["E24:4"], "topic"),
    ("E23:1", ["E24:2"], "experience"),
]
EVAL_UNRELATED = ["E08:1", "E10:2", "E12:4", "E14:4", "E17:2", "E20:3", "E22:3", "E23:2",
                  "E27:1", "E27:2", "E28:1", "E28:2", "E29:0", "E29:1", "E30:1", "E30:2"]

if __name__ == "__main__":
    write("dev", DEV_RELATED, DEV_UNRELATED)
    write("eval", EVAL_RELATED, EVAL_UNRELATED)
