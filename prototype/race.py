"""Make a race replay: your newest run vs another player's run on the same seed.

python3 race.py [--you cyoshi] [--them Chavron]
Looks through Ranked's replay folders, pairs your newest v40+ run with a run by
someone else on the same overworld+nether seed, writes the combined file to My
replays and prints the findings.
"""
import argparse, glob, json, os, sys, time, zipfile
import merge, findings

MC = os.path.expanduser("~/.local/share/PrismLauncher/instances/MCSRRanked-Linux-1.16.1-All/minecraft/mcsrranked")


def replays():
    out = []
    for f in glob.glob(MC + "/temp-replay/**/*.rrf", recursive=True) + glob.glob(MC + "/replay/*.rrf"):
        if os.path.basename(f).startswith(("vs ", "stratas")): continue
        try: m = json.loads(zipfile.ZipFile(f).read("meta.json"))
        except Exception: continue
        if m.get("symmetricKey") or m.get("version", 0) < 40: continue
        out.append((os.path.getmtime(f), f, m))
    return sorted(out, reverse=True)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--you", default="cyoshi"); ap.add_argument("--them")
    ap.add_argument("--seed", action="store_true", help="print the seed of the newest downloaded replay you're not in")
    a = ap.parse_args()
    rs = replays()
    if a.seed:
        t, f, m = next(((t, f, m) for t, f, m in rs if all(p["nickname"].lower() != a.you.lower() for p in m["players"])), (0, None, None))
        if not f: sys.exit("no downloaded replay without you in it yet")
        print(f"{' vs '.join(p['nickname'] for p in m['players'])}  ({os.path.relpath(f, MC)})")
        print(f"overworld seed: {m['overworldSeed']}\nnether seed:    {m['netherSeed']}")
        return
    mine = [(t, f, m) for t, f, m in rs if any(p["nickname"].lower() == a.you.lower() for p in m["players"])]
    if not mine: sys.exit("no v40+ replay of yours found")
    for t, f, m in mine:   # newest run of yours that has a partner run on the same seed
        seed = (m["overworldSeed"], m["netherSeed"])
        me = next(p for p in m["players"] if p["nickname"].lower() == a.you.lower())
        partners = [(f2, p) for _, f2, m2 in rs if (m2["overworldSeed"], m2["netherSeed"]) == seed
                    for p in m2["players"] if p["uuid"] != me["uuid"] and (not a.them or p["nickname"].lower() == a.them.lower())
                    and not (f2 == f and len(m["players"]) == 2 and not a.them)]  # skip the opponent of a ranked match unless asked
        if partners: break
    else: sys.exit("no other player's run on any seed you played (download their replay in Ranked first)")
    pf, them = partners[0]
    name = f"vs {them['nickname']} {time.strftime('%Y-%m-%d %H%M')}.rrf"
    out = os.path.join(MC, "replay", name)
    merge.merge([(f, me["uuid"]), (pf, them["uuid"])], out)
    print(f"your run:  {os.path.relpath(f, MC)}\ntheir run: {os.path.relpath(pf, MC)} ({them['nickname']})\nwrote My replays/{name}\n")
    sys.argv = ["findings", out, me["nickname"]]
    findings.main()


if __name__ == "__main__":
    main()
