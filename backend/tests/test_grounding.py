from app.utils.grounding import clean_text, collect_numbers, ground_list, ground_text

EVIDENCE = {"scores": {"need": 67.3, "demand_percentile": 2.1}, "population": 255230, "indicators": [{"value": 30.6}]}


def test_keeps_grounded_sentences():
    allowed = collect_numbers(EVIDENCE)
    removed: list[str] = []
    out = ground_text("Need is 67.3. Improved sanitation covers 30.6% of people.", allowed, removed)
    assert out == "Need is 67.3. Improved sanitation covers 30.6% of people."
    assert removed == []


def test_removes_invented_statistics():
    allowed = collect_numbers(EVIDENCE)
    removed: list[str] = []
    out = ground_text("Need is 67.3. About 48% of wells are dry.", allowed, removed)
    assert out == "Need is 67.3."
    assert len(removed) == 1 and "48" in removed[0]


def test_allows_years_small_counts_and_scaled_population():
    allowed = collect_numbers(EVIDENCE)
    removed: list[str] = []
    assert ground_text("In 2019 three categories matter; population is 2.6 lakh.", allowed, removed)
    assert removed == []


def test_list_and_clean():
    removed: list[str] = []
    assert ground_list(["ok 67.3", "bad 999.9"], collect_numbers(EVIDENCE), removed) == ["ok 67.3"]
    assert clean_text("<b>**bold**</b>\x07 text") == "bold text"
