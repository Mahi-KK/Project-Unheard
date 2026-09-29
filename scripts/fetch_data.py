"""Download the raw public datasets UNHEARD is built from.

    python scripts/fetch_data.py         # skip files that already exist
    python scripts/fetch_data.py --force

Sources, licences and caveats: data/metadata/sources.json, docs/data-sources.md
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"

FILES = {
    "nfhs5_districts.csv": "https://raw.githubusercontent.com/jvargh7/nfhs5_factsheets/main/data%20for%20analysis/districts.csv",
    "census2011_districts.csv": "https://raw.githubusercontent.com/nishusharma1608/India-Census-2011-Analysis/master/india-districts-census-2011.csv",
    "india-districts-2019-734.json": "https://raw.githubusercontent.com/guneetnarula/indian-district-boundaries/master/topojson/india-districts-2019-734.json",
    "boundaries_LICENSE.txt": "https://raw.githubusercontent.com/guneetnarula/indian-district-boundaries/master/LICENSE",
}


def main() -> None:
    force = "--force" in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        dest = RAW / name
        if dest.exists() and not force:
            print(f"skip  {name}")
            continue
        print(f"fetch {name} <- {url}")
        with urllib.request.urlopen(url, timeout=60) as r:
            dest.write_bytes(r.read())
    print("done. next: python scripts/build_dataset.py")


if __name__ == "__main__":
    main()
