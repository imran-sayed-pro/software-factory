"""Software Factory explainer, in the style of 3Blue1Brown (Manim Community).

Each scene is timed to its narration. Visual beats are anchored to phrases with `self.at("phrase")`.
With build/<scene>.alignment.json (ElevenLabs character timestamps) the beats land on the spoken
word; without it, times are estimated from the phrase's position in the text (silent preview).
"""
import json
import os

from manim import *

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
SCRIPT = json.load(open(os.path.join(HERE, "script.json")))

BG = "#0e1117"
INK = "#e6e6e6"
DIM = "#8b949e"
BLUE = "#58c4dd"
YELLOW = "#ffd866"
GREEN = "#83c167"
RED = "#fc6255"
PURPLE = "#9a72ac"
config.background_color = BG
FONT = "DejaVu Sans"


def label(s, size=28, color=INK, **kw):
    return Text(s, font=FONT, font_size=size, color=color, **kw)


def box(s, w=1.75, h=0.75, color=BLUE, size=22, fill=0.12):
    r = RoundedRectangle(width=w, height=h, corner_radius=0.12, color=color, stroke_width=2.5)
    r.set_fill(color, opacity=fill)
    t = label(s, size=size)
    if t.width > w - 0.15:
        t.scale_to_fit_width(w - 0.15)
    return VGroup(r, t.move_to(r))


class Narrated(Scene):
    sid = None

    def setup(self):
        scene = next(s for s in SCRIPT["scenes"] if s["id"] == self.sid)
        self.text = scene["text"]
        self.clock = 0.0
        self.starts = None
        al = os.path.join(BUILD, f"{self.sid}.alignment.json")
        timings = os.path.join(BUILD, "timings.json")
        self.T = len(self.text.split()) / 2.55 + 0.8  # estimate for a silent preview
        if os.path.exists(timings):
            self.T = json.load(open(timings)).get(self.sid, self.T)
        if os.path.exists(al):
            a = json.load(open(al))
            if len(a.get("characters", [])) == len(self.text):
                self.starts = a["character_start_times_seconds"]

    def t_of(self, phrase):
        i = self.text.find(phrase)
        if i < 0:
            raise ValueError(f"phrase not in narration: {phrase!r}")
        return self.starts[i] if self.starts else self.T * i / len(self.text)

    def at(self, phrase, lead=0.15):
        """Wait until just before `phrase` is spoken."""
        t = self.t_of(phrase) - lead
        if t > self.clock + 0.02:
            self.hold(t - self.clock)

    def go(self, *anims, rt=0.8, **kw):
        self.play(*anims, run_time=rt, **kw)
        self.clock += rt

    def hold(self, d):
        if d > 0:
            self.wait(d)
            self.clock += d

    def finish(self, tail=0.7):
        self.hold(self.T + tail - self.clock)


# 1 ──────────────────────────────────────────────────────────────────────────
class Hook(Narrated):
    sid = "s1_hook"

    def construct(self):
        axis = Line(LEFT * 5, RIGHT * 5, color=DIM, stroke_width=2).shift(DOWN * 0.6)
        wl = label("code written", 24, BLUE).next_to(axis.get_start(), UP + RIGHT, buff=0.2).shift(UP * 1.6)
        rl = label("code reviewed", 24, YELLOW).next_to(wl, DOWN, buff=1.0, aligned_edge=LEFT)
        wbar = Rectangle(width=0.01, height=0.45, color=BLUE, fill_opacity=0.85, stroke_width=0).next_to(wl, DOWN, buff=0.12, aligned_edge=LEFT)
        rbar = Rectangle(width=0.01, height=0.45, color=YELLOW, fill_opacity=0.85, stroke_width=0).next_to(rl, DOWN, buff=0.12, aligned_edge=LEFT)
        self.go(FadeIn(wl), FadeIn(rl), FadeIn(wbar), FadeIn(rbar), rt=0.6)
        self.go(
            wbar.animate.stretch_to_fit_width(9.5, about_edge=LEFT),
            rbar.animate.stretch_to_fit_width(2.2, about_edge=LEFT),
            rt=2.6, rate_func=rate_functions.ease_in_out_sine,
        )
        gap = BraceBetweenPoints(rbar.get_right() + UP * 0.05, wbar.get_right() * RIGHT + rbar.get_right() * UP + UP * 0.05, direction=DOWN, color=RED)
        gl = label("unreviewed", 22, RED).next_to(gap, DOWN, buff=0.1)
        self.go(GrowFromCenter(gap), FadeIn(gl), rt=0.7)

        self.at("It's trusting")
        bars = VGroup(wl, rl, wbar, rbar, gap, gl)
        trust = label("trust", 96, YELLOW)
        sub = label("the code you merge", 34, INK).next_to(trust, DOWN, buff=0.3)
        self.go(FadeOut(bars, shift=UP * 0.4), Write(trust), rt=1.0)
        self.go(FadeIn(sub, shift=UP * 0.2), rt=0.5)

        self.at("This is a software factory")
        title = label("software factory", 64, INK)
        tag = label("a pipeline for Claude Code", 30, DIM).next_to(title, DOWN, buff=0.35)
        self.go(FadeOut(sub), ReplacementTransform(trust, title), rt=0.9)
        self.go(FadeIn(tag), rt=0.5)

        self.at("many AI workers")
        workers = VGroup(*[Dot(radius=0.13, color=c) for c in [BLUE, GREEN, PURPLE, YELLOW]]).arrange(RIGHT, buff=0.6)
        workers.next_to(tag, DOWN, buff=0.8)
        self.go(LaggedStart(*[GrowFromCenter(w) for w in workers], lag_ratio=0.2), rt=0.8)
        self.go(*[w.animate.shift(RIGHT * 0.35) for w in workers], rt=0.5, rate_func=there_and_back)

        self.at("still lets you trust")
        check = label("✓ trusted", 30, GREEN).next_to(workers, DOWN, buff=0.45)
        self.go(FadeIn(check, shift=UP * 0.2), rt=0.6)

        self.at("Let's see")
        self.go(FadeOut(VGroup(title, tag, workers, check)), rt=0.8)
        self.finish()


# 2 ──────────────────────────────────────────────────────────────────────────
class TheLine(Narrated):
    sid = "s2_line"

    def construct(self):
        names = ["spec", "plan\nreview", "dispatch", "build", "review\ngate", "QA\nverify", "ship"]
        boxes = VGroup(*[box(n, w=1.35, h=0.95, size=22) for n in names]).arrange(RIGHT, buff=0.3)
        boxes[2:].shift(RIGHT * 0.35)  # room for gate 1
        boxes.move_to(UP * 0.4).shift(LEFT * 0.35)  # room for gate 2 on the right
        # Gates sit in the gap after plan review and after ship.
        def gate_at(x, n):
            bar = Rectangle(width=0.12, height=1.7, color=YELLOW, fill_opacity=0.9, stroke_width=0).move_to([x, boxes.get_y(), 0])
            t = label(f"Gate {n}", 20, YELLOW).next_to(bar, UP, buff=0.12)
            h = label("human", 18, DIM).next_to(bar, DOWN, buff=0.12)
            return VGroup(bar, t, h)
        g1x = (boxes[1].get_right()[0] + boxes[2].get_left()[0]) / 2
        g2x = boxes[6].get_right()[0] + 0.4
        gate1, gate2 = gate_at(g1x, 1), gate_at(g2x, 2)
        title = label("Every change travels the same line", 32).to_edge(UP, buff=0.6)
        self.go(FadeIn(title, shift=DOWN * 0.2), rt=0.6)

        self.at("It starts as a spec")
        self.go(FadeIn(boxes[0], shift=UP * 0.2), rt=0.5)
        self.at("cut into small cards")
        cards = VGroup(*[Square(0.28, color=BLUE, fill_opacity=0.6, stroke_width=1.5) for _ in range(4)]).arrange(RIGHT, buff=0.08)
        cards.next_to(boxes[0], DOWN, buff=0.6)
        self.go(LaggedStart(*[FadeIn(c, scale=0.5) for c in cards], lag_ratio=0.15), rt=0.7)

        self.at("Plan review")
        self.go(FadeIn(boxes[1], shift=UP * 0.2), cards.animate.next_to(boxes[1], DOWN, buff=0.6), rt=0.7)
        self.at("a human approves")
        self.go(FadeIn(gate1, shift=DOWN * 0.2), rt=0.6)
        self.at("That's the first gate")
        self.go(Indicate(gate1[0], color=YELLOW, scale_factor=1.15), rt=0.6)

        self.at("Then dispatch")
        self.go(FadeIn(boxes[2], shift=UP * 0.2), cards.animate.next_to(boxes[2], DOWN, buff=0.6), rt=0.7)
        lanes = VGroup(*[c.copy() for c in cards])
        self.at("its own worker")
        for i, c in enumerate(lanes):
            c.move_to(boxes[2].get_center() + DOWN * (1.0 + 0.38 * i))
        self.go(*[Transform(cards[i], lanes[i]) for i in range(4)], rt=0.6)

        steps = [("The worker builds it", 3), ("the review gate", 4), ("QA proves", 5), ("ship opens", 6)]
        for phrase, k in steps:
            self.at(phrase)
            self.go(FadeIn(boxes[k], shift=UP * 0.2),
                    *[cards[i].animate.move_to(boxes[k].get_center() + DOWN * (1.0 + 0.38 * i)) for i in range(4)], rt=0.6)

        self.at("A human merges")
        self.go(FadeIn(gate2, shift=DOWN * 0.2), rt=0.6)
        self.go(*[cards[i].animate.set_color(GREEN) for i in range(4)], Indicate(gate2[0], color=YELLOW, scale_factor=1.15), rt=0.7)

        self.at("Everything between")
        brace = BraceBetweenPoints([gate1.get_x() + 0.1, boxes.get_y() - 2.7, 0], [gate2.get_x() - 0.1, boxes.get_y() - 2.7, 0], direction=DOWN, color=BLUE)
        auto = label("automated", 26, BLUE).next_to(brace, DOWN, buff=0.12)
        self.go(GrowFromCenter(brace), FadeIn(auto), rt=0.8)
        self.finish()
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.5)


# 3 ──────────────────────────────────────────────────────────────────────────
class CardsInParallel(Narrated):
    sid = "s3_cards"

    def card(self, cid, files, color):
        r = RoundedRectangle(width=2.6, height=1.05, corner_radius=0.1, color=color, stroke_width=2.5).set_fill(color, 0.12)
        t = label(cid, 24).move_to(r).shift(UP * 0.2)
        f = label(files, 18, DIM).move_to(r).shift(DOWN * 0.22)
        return VGroup(r, t, f)

    def construct(self):
        title = label("Parallelism comes from cards", 32).to_edge(UP, buff=0.5)
        self.go(FadeIn(title, shift=DOWN * 0.2), rt=0.6)
        c1 = self.card("C-001", "src/math.js", BLUE)
        c2 = self.card("C-002", "src/mul.js", PURPLE)
        c3 = self.card("C-003", "src/math.js", YELLOW)
        cards = VGroup(c1, c2, c3).arrange(DOWN, buff=0.35).to_edge(LEFT, buff=0.8).shift(DOWN * 0.3)
        self.go(LaggedStart(*[FadeIn(c, shift=RIGHT * 0.3) for c in cards], lag_ratio=0.2), rt=0.9)

        self.at("which files it may touch")
        self.go(*[Indicate(c[2], color=INK, scale_factor=1.2) for c in cards], rt=0.7)

        lane_y = [0.9, -0.5]
        lanes = VGroup()
        for i, y in enumerate(lane_y):
            ln = Line([-0.9, y, 0], [5.6, y, 0], color=DIM, stroke_width=2)
            tag = label(f"worktree {i + 1}", 18, DIM).next_to(ln, UP, buff=0.08, aligned_edge=LEFT)
            lanes.add(VGroup(ln, tag))
        self.at("Two cards whose files")
        self.go(FadeIn(lanes), rt=0.5)
        self.at("run at the same time")
        self.go(c1.animate.scale(0.75).move_to([0.6, lane_y[0] - 0.45, 0]),
                c2.animate.scale(0.75).move_to([0.6, lane_y[1] - 0.45, 0]), rt=0.8)
        self.go(c1.animate.shift(RIGHT * 2.2), c2.animate.shift(RIGHT * 2.2), rt=1.4, rate_func=linear)

        self.at("Cards that share a file")
        lock = label("waits: src/math.js", 20, RED).next_to(c3, RIGHT, buff=0.25)
        link = always_redraw(lambda: DashedLine(c3.get_right(), c1.get_left(), color=RED, stroke_width=2))
        self.go(Create(link), FadeIn(lock), rt=0.7)

        self.at("A card that needs")
        dep = label("needs C-001", 20, YELLOW).next_to(lock, DOWN, buff=0.12, aligned_edge=LEFT)
        self.go(FadeIn(dep), rt=0.5)
        self.at("doesn't start when that card is finished")
        done = label("done", 20, GREEN).next_to(c1, UP, buff=0.08)
        self.go(c1.animate.shift(RIGHT * 1.6), c2.animate.shift(RIGHT * 1.6), rt=0.8)
        self.go(FadeIn(done), Wiggle(lock), rt=0.7)

        self.at("It starts when it's merged")
        main = Line([-6.6, -2.9, 0], [6.6, -2.9, 0], color=GREEN, stroke_width=4)
        ml = label("main", 20, GREEN).next_to(main, UP, buff=0.08).to_edge(RIGHT, buff=0.5)
        self.go(Create(main), FadeIn(ml), rt=0.6)
        merged = label("merged", 20, GREEN).move_to(done)
        self.go(c1.animate.move_to([4.6, -2.9, 0]).set_opacity(0.5), Transform(done, merged.next_to([4.6, -2.9, 0], UP, buff=0.5)), rt=0.9)
        self.go(FadeOut(link), FadeOut(lock), FadeOut(dep),
                c3.animate.scale(0.75).move_to([0.6, lane_y[0] - 0.45, 0]), rt=0.8)
        self.go(c3.animate.shift(RIGHT * 2.0), rt=1.0, rate_func=linear)

        self.at("Until then")
        note = label("unmerged work keeps its files locked", 24, RED).to_edge(DOWN, buff=0.25).shift(UP * 0.0)
        self.go(FadeIn(note, shift=UP * 0.2), rt=0.6)
        self.finish()
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.5)


# 4 ──────────────────────────────────────────────────────────────────────────
class TestFirstAndFloor(Narrated):
    sid = "s4_floor"

    def construct(self):
        title = label("Inside a worker: test first", 32).to_edge(UP, buff=0.5)
        self.go(FadeIn(title, shift=DOWN * 0.2), rt=0.6)
        worker = label("worker on C-001", 22, DIM).next_to(title, DOWN, buff=0.4)
        self.go(FadeIn(worker), rt=0.5)
        test = box("test", w=2.0, h=0.8, color=INK, size=24).shift(LEFT * 3 + UP * 0.6)
        code = box("code", w=2.0, h=0.8, color=INK, size=24).shift(RIGHT * 3 + UP * 0.6)
        self.at("writes a test")
        self.go(FadeIn(test, shift=UP * 0.2), rt=0.6)
        self.at("watches it fail")
        red = label("✗ fails", 30, RED).next_to(test, DOWN, buff=0.35)
        self.go(test[0].animate.set_color(RED), FadeIn(red), rt=0.6)
        self.at("for the right reason")
        why = label("assertion, not a typo", 20, DIM).next_to(red, DOWN, buff=0.15)
        self.go(FadeIn(why), rt=0.5)
        self.at("smallest change")
        arrow = Arrow(test.get_right(), code.get_left(), color=DIM, buff=0.2)
        self.go(GrowArrow(arrow), FadeIn(code, shift=UP * 0.2), rt=0.7)
        green = label("✓ passes", 30, GREEN).move_to(red)
        self.go(test[0].animate.set_color(GREEN), Transform(red, green), FadeOut(why), rt=0.6)

        self.at("And there's a floor")
        top = VGroup(title, worker, test, code, arrow, red)
        self.go(FadeOut(top, shift=UP * 0.5), rt=0.6)
        bar = Line(LEFT * 6, RIGHT * 6, color=YELLOW, stroke_width=6).shift(DOWN * 0.4)
        bl = label("CONSTRAINTS.md", 24, YELLOW).next_to(bar, DOWN, buff=0.15).to_edge(LEFT, buff=1.0)
        self.go(Create(bar), FadeIn(bl), rt=0.8)
        self.at("every rule next to")
        rules = VGroup(
            label("tests pass  ·  npm test", 20, DIM),
            label("lint clean  ·  npm run lint", 20, DIM),
            label("changed lines ≥ 80% covered  ·  coverage", 20, DIM),
        ).arrange(DOWN, buff=0.12, aligned_edge=LEFT).next_to(bar, DOWN, buff=0.75).to_edge(RIGHT, buff=1.0)
        self.go(LaggedStart(*[FadeIn(r, shift=LEFT * 0.2) for r in rules], lag_ratio=0.25), rt=0.9)

        self.at("A floor guard")
        guard = label("floor guard", 24, INK).next_to(bar, UP, buff=0.12).to_edge(RIGHT, buff=1.0)
        self.go(FadeIn(guard), bar.animate.set_stroke(width=9), rt=0.6)
        # Split strings: these are on-screen examples, and whole they would trip the repo's own floor guard.
        shortcuts = [("a skipped test", "test." + "skip(…)"), ("a deleted assertion", "− assert.equal(…)"),
                     ("a silenced warning", "// eslint-" + "disable"), ("a rule quietly loosened", "≥ 80%  →  ≥ 60%")]
        xs = [-4.8, -1.6, 1.6, 4.8]
        for (phrase, code_s), x in zip(shortcuts, xs):
            self.at(phrase, lead=0.3)
            chip = box(code_s, w=2.9, h=0.6, color=INK, size=18, fill=0.06).move_to([x, 2.6, 0])
            self.add(chip)
            self.go(chip.animate.move_to([x, 0.05, 0]), rt=0.45, rate_func=rate_functions.ease_in_quad)
            chip[0].set_stroke(RED).set_fill(RED, 0.15)
            chip[1].set_color(RED)
            self.go(chip.animate.shift(UP * 0.9), rt=0.35, rate_func=rate_functions.ease_out_back)
            blocked = label("blocked", 18, RED).next_to(chip, UP, buff=0.08)
            self.go(FadeIn(blocked), rt=0.2)
        self.finish()
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.5)


# 5 ──────────────────────────────────────────────────────────────────────────
class ProofBoundToCode(Narrated):
    sid = "s5_proof"

    def construct(self):
        code = VGroup(*[Rectangle(width=w, height=0.16, stroke_width=0, fill_color=c, fill_opacity=0.8)
                        for w, c in [(2.6, BLUE), (1.8, INK), (2.2, INK), (1.2, PURPLE), (2.4, INK), (1.6, BLUE)]])
        code.arrange(DOWN, buff=0.18, aligned_edge=LEFT)
        frame = SurroundingRectangle(code, color=DIM, buff=0.3, corner_radius=0.1)
        codeg = VGroup(frame, code).shift(LEFT * 4 + UP * 0.3)
        cl = label("the code", 22, DIM).next_to(frame, UP, buff=0.15)
        self.go(FadeIn(codeg), FadeIn(cl), rt=0.6)

        self.at("fresh reviewer agents")
        revs = VGroup(*[VGroup(Circle(0.32, color=c, fill_opacity=0.2), label(n, 16).shift(DOWN * 0.55))
                        for n, c in [("code", BLUE), ("tests", GREEN), ("security", RED)]]).arrange(RIGHT, buff=0.55)
        revs.shift(UP * 2.2 + RIGHT * 0.6)
        self.go(LaggedStart(*[FadeIn(r, shift=DOWN * 0.3) for r in revs], lag_ratio=0.2), rt=0.8)
        self.at("never saw")
        nope = label("no author notes", 18, DIM).next_to(revs, RIGHT, buff=0.4)
        self.go(FadeIn(nope), rt=0.4)

        self.at("Their verdict is recorded")
        verdict = box("APPROVE", w=2.6, h=0.8, color=GREEN, size=26).shift(RIGHT * 3.4 + UP * 0.3)
        self.go(*[r.animate.scale(0.8).set_opacity(0.6) for r in revs], FadeIn(verdict, shift=LEFT * 0.3), rt=0.7)
        self.at("a hash of the exact code")
        h1 = label("tree 9f3a1c…", 22, YELLOW).next_to(verdict, DOWN, buff=0.2)
        tie = DashedLine(frame.get_right(), h1.get_left(), color=YELLOW, stroke_width=2)
        self.go(Create(tie), FadeIn(h1), rt=0.8)
        self.at("QA works the same way")
        qa = box("QA  PASS", w=2.6, h=0.7, color=GREEN, size=22).next_to(h1, DOWN, buff=0.3)
        self.go(FadeIn(qa, shift=UP * 0.2), rt=0.5)

        self.at("Change one line")
        self.go(code[3].animate.set_color(RED).stretch_to_fit_width(2.0, about_edge=LEFT), rt=0.6)
        self.at("the hash no longer matches")
        h2 = label("now 4c1e07…", 22, RED).next_to(frame, DOWN, buff=0.25)
        neq = label("≠", 40, RED).move_to((h2.get_center() + h1.get_center()) / 2)
        self.go(FadeIn(h2), FadeIn(neq), tie.animate.set_color(RED), rt=0.7)
        self.at("The verdict is stale")
        stale = box("STALE", w=2.6, h=0.8, color=RED, size=26).move_to(verdict)
        stale_qa = box("QA  STALE", w=2.6, h=0.7, color=RED, size=22).move_to(qa)
        self.go(Transform(verdict, stale), Transform(qa, stale_qa), rt=0.6)
        self.at("ship refuses it")
        ship = box("ship", w=1.8, h=0.8, color=INK, size=24).next_to(qa, DOWN, buff=0.45)
        x = label("✗ refused", 24, RED).next_to(ship, LEFT, buff=0.3)
        self.go(FadeIn(ship), rt=0.4)
        self.go(FadeIn(x, shift=RIGHT * 0.2), ship[0].animate.set_color(RED), rt=0.4)

        self.at("The proof has to exist")
        everything = Group(*self.mobjects)
        motto = VGroup(label("proof must exist", 40, INK), label("and match the code", 40, YELLOW)).arrange(DOWN, buff=0.25)
        self.go(FadeOut(everything), rt=0.5)
        self.go(FadeIn(motto[0], shift=UP * 0.2), rt=0.5)
        self.at("it has to match")
        self.go(FadeIn(motto[1], shift=UP * 0.2), rt=0.5)
        self.finish()
        self.play(FadeOut(motto), run_time=0.5)


# 6 ──────────────────────────────────────────────────────────────────────────
class RealRun(Narrated):
    sid = "s6_story"

    def construct(self):
        title = label("The first real run", 32).to_edge(UP, buff=0.5)
        self.go(FadeIn(title, shift=DOWN * 0.2), rt=0.6)
        self.at("Every unit test was green")
        checks = VGroup(*[label("✓", 30, GREEN) for _ in range(12)]).arrange(RIGHT, buff=0.28).shift(UP * 1.8)
        ut = label("unit tests", 20, DIM).next_to(checks, LEFT, buff=0.3)
        self.go(FadeIn(ut), LaggedStart(*[FadeIn(c, scale=0.5) for c in checks], lag_ratio=0.05), rt=0.9)

        self.at("with real AI workers")
        worker = box("worker", w=1.9, h=0.8, color=BLUE, size=22).shift(LEFT * 3.5 + UP * 0.1)
        plugin = box("plugin: skills + hooks", w=3.4, h=0.8, color=PURPLE, size=20).shift(RIGHT * 2.8 + UP * 0.1)
        wire = Line(worker.get_right(), plugin.get_left(), color=PURPLE, stroke_width=3)
        self.go(FadeIn(worker), FadeIn(plugin), Create(wire), rt=0.8)
        self.at("never loaded the plugin")
        cut = DashedLine(worker.get_right(), plugin.get_left(), color=RED, stroke_width=3)
        self.go(ReplacementTransform(wire, cut), plugin.animate.set_opacity(0.35), rt=0.7)
        self.at("No skills, no safety hooks")
        self.go(Wiggle(plugin), rt=0.6)

        self.at("One worker decided")
        review = box("review", w=1.7, h=0.7, color=DIM, size=20).shift(DOWN * 1.6)
        queue = box("merge queue", w=2.4, h=0.8, color=INK, size=20).shift(RIGHT * 3.6 + DOWN * 1.6)
        card = Square(0.32, color=YELLOW, fill_opacity=0.8).next_to(worker, DOWN, buff=0.7)
        self.go(FadeIn(review), FadeIn(queue), FadeIn(card), rt=0.6)
        path = ArcBetweenPoints(card.get_center(), queue.get_left() + LEFT * 0.3, angle=-PI / 3)
        skip = label("skipped review", 20, YELLOW).next_to(review, UP, buff=0.25)
        self.go(MoveAlongPath(card, path), FadeIn(skip), rt=1.2)
        self.at("The merge queue refused it")
        refused = label("review missing", 22, RED).next_to(queue, DOWN, buff=0.2)
        self.go(queue[0].animate.set_color(RED), FadeIn(refused), card.animate.shift(LEFT * 0.6), rt=0.7)

        self.at("After the fix")
        self.go(FadeOut(Group(*[m for m in self.mobjects if m is not title])), rt=0.6)
        rows = [("C-001  subtract", "parallel", "86 s", "$0.82"),
                ("C-002  multiply", "parallel", "87 s", "$0.82"),
                ("C-003  divide", "after merge", "96 s", "$0.81")]
        table = VGroup()
        for i, (a, b, c, d) in enumerate(rows):
            row = VGroup(label(a, 24), label(b, 22, DIM), label(c, 24, BLUE), label(d, 24, YELLOW))
            for j, x in enumerate([-4.6, -0.9, 2.0, 3.9]):
                row[j].move_to([x, 1.0 - i * 0.75, 0], aligned_edge=LEFT if j < 2 else ORIGIN)
            table.add(row)
        self.at("three cards ran")
        self.go(LaggedStart(*[FadeIn(r[0], shift=RIGHT * 0.2) for r in table], lag_ratio=0.2), rt=0.8)
        self.at("Two in parallel")
        self.go(FadeIn(table[0][1]), FadeIn(table[1][1]), rt=0.5)
        self.at("a third waiting")
        self.go(FadeIn(table[2][1]), rt=0.5)
        self.at("About ninety seconds")
        self.go(*[FadeIn(r[2]) for r in table], rt=0.5)
        self.at("eighty cents")
        self.go(*[FadeIn(r[3]) for r in table], rt=0.5)
        self.at("no escalations")
        ok = label("0 escalations", 30, GREEN).shift(DOWN * 1.8)
        self.go(FadeIn(ok, shift=UP * 0.2), rt=0.5)
        self.finish()
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.5)


# 7 ──────────────────────────────────────────────────────────────────────────
class Close(Narrated):
    sid = "s7_close"

    def construct(self):
        speed = VGroup(label("speed", 44, BLUE), label("parallel workers", 28, DIM)).arrange(DOWN, buff=0.2)
        trust = VGroup(label("trust", 44, YELLOW),
                       VGroup(label("tests first", 28, DIM), label("a floor that can't be lowered", 28, DIM),
                              label("proof tied to the code", 28, DIM)).arrange(DOWN, buff=0.12)).arrange(DOWN, buff=0.2)
        cols = VGroup(speed, trust).arrange(RIGHT, buff=2.2, aligned_edge=UP).shift(UP * 1.2)
        self.at("speed comes")
        self.go(FadeIn(speed[0], shift=UP * 0.2), rt=0.5)
        self.at("parallel workers")
        self.go(FadeIn(speed[1]), rt=0.4)
        self.at("Trust comes")
        self.go(FadeIn(trust[0], shift=UP * 0.2), rt=0.5)
        for phrase, k in [("tests first", 0), ("a floor", 1), ("proof tied", 2)]:
            self.at(phrase)
            self.go(FadeIn(trust[1][k], shift=RIGHT * 0.2), rt=0.4)

        self.at("Two decisions stay human")
        human = VGroup(box("approve the plan", w=3.2, h=0.75, color=YELLOW, size=22),
                       box("merge the code", w=3.2, h=0.75, color=YELLOW, size=22)).arrange(RIGHT, buff=0.6).shift(DOWN * 1.4)
        self.go(FadeIn(human[0], shift=UP * 0.2), rt=0.5)
        self.at("and merging")
        self.go(FadeIn(human[1], shift=UP * 0.2), rt=0.5)

        self.at("Software factory is open source")
        title = label("software factory", 60, INK).shift(UP * 0.4)
        url = label("github.com/imran-sayed-pro/software-factory", 28, BLUE).next_to(title, DOWN, buff=0.4)
        self.go(FadeOut(VGroup(cols, human)), rt=0.5)
        self.go(Write(title), rt=0.9)
        self.at("on GitHub")
        self.go(FadeIn(url, shift=UP * 0.2), rt=0.6)
        self.finish(tail=1.6)


SCENES = [Hook, TheLine, CardsInParallel, TestFirstAndFloor, ProofBoundToCode, RealRun, Close]
