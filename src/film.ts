/**
 * Entry for the framefields renderer worker. Every export is a function the
 * worker calls; the job's `target.export` picks one.
 *
 * - film:      the 2D scenes back to back with transitions, score and grain
 * - threeD:    lit 3D scene with a glTF model
 * - vision:    ONNX segmentation, pose and detection on video
 * - all:       film + threeD + vision as three outputs (one job, three files)
 * - split:     2 minutes for split renders (`workers: 2`): the 2D scenes ten
 *              times over, with particles and a trail that carry state
 *              across every chunk seam
 * - title, media, effects, charts: one 2D scene each, for isolating failures
 */
import {
	type Composition,
	FilmGrain,
	Layer,
	LayerAnimation,
	Trails,
	Transition,
} from "framefields";
import { CHARTS_FRAMES, chartsScene } from "./scenes/charts.js";
import { EFFECTS_FRAMES, effectsScene } from "./scenes/effects.js";
import { MEDIA_FRAMES, mediaScene } from "./scenes/media.js";
import { THREE_D_FRAMES, threeDLayers } from "./scenes/three-d.js";
import { TITLE_FRAMES, titleScene } from "./scenes/title.js";
import { VISION_FRAMES, visionLayers } from "./scenes/vision.js";
import { asset, composition, EMBER, FPS, H, PAPER, W } from "./theme.js";

const T = 18; // transition length, frames

/** The four 2D scenes back to back, `rounds` times, with transitions between them. */
function scenes(rounds: number) {
	return Layer.sequence(
		Array.from({ length: rounds }).flatMap((_, round) => [
			{
				scene: titleScene(),
				duration: TITLE_FRAMES,
				...(round > 0 && { transition: Transition.iris(T) }),
			},
			{
				scene: mediaScene(),
				duration: MEDIA_FRAMES,
				transition: Transition.push("left", T),
			},
			{
				scene: effectsScene(),
				duration: EFFECTS_FRAMES,
				transition: Transition.wipe("right", T),
			},
			{
				scene: chartsScene(),
				duration: CHARTS_FRAMES,
				transition: Transition.iris(T),
			},
		]),
		{ width: W, height: H },
	);
}

export async function film(): Promise<Composition> {
	const sequence = scenes(1);
	const comp = await composition(sequence.totalFrames);
	comp.add(sequence);
	comp.add(
		Layer.audio(asset("score.mp3"), {
			id: "score",
			volume: 0.8,
			durationFrames: sequence.totalFrames,
		}),
	);
	comp.apply(new FilmGrain({ strength: 6, size: 1.4, animated: true }));
	return comp;
}

export async function threeD(): Promise<Composition> {
	const comp = await composition(THREE_D_FRAMES);
	comp.add(threeDLayers());
	return comp;
}

export async function vision(): Promise<Composition> {
	const comp = await composition(VISION_FRAMES, "#000000");
	comp.add(visionLayers());
	return comp;
}

/**
 * Two minutes for split renders. The particles and the trail depend on every
 * frame before them, so a chunk that starts mid-film has to rebuild their
 * state: compare the frames around each seam with a single-worker render.
 */
export async function split(): Promise<Composition> {
	const sequence = scenes(10);
	const frames = sequence.totalFrames;
	const comp = await composition(frames);
	comp.add(sequence);
	comp.add(
		Layer.particles({
			width: W,
			height: H,
			max: 4000,
			emitter: { shape: "point", x: W / 2, y: H + 10, rate: 240 },
			direction: -90,
			spread: 40,
			speed: [160, 260],
			lifetime: [4, 4],
			size: [4, 7],
			color: EMBER,
			fade: [0.2, 0.6],
		}),
	);
	const lap = 6 * FPS;
	comp.add(
		Layer.shape("circle", {
			id: "comet",
			fillColor: PAPER,
			width: 36,
			height: 36,
			position: "absolute",
			x: 0,
			y: H / 2,
		})
			.animate(
				LayerAnimation.keys(
					"x",
					Array.from({ length: Math.floor((frames - 1) / lap) + 1 }, (_, i) => [
						i * lap,
						i % 2 === 0 ? 40 : W - 76,
						"sine.inOut",
					]),
				),
			)
			.withEffect(new Trails({ decay: 0.9 })),
	);
	// The score is 30 s: play it back to back for the whole film.
	const scoreFrames = 30 * FPS;
	for (let start = 0; start < frames; start += scoreFrames)
		comp.add(
			Layer.audio(asset("score.mp3"), {
				id: `score-${start}`,
				volume: 0.8,
				startFrame: start,
				durationFrames: Math.min(scoreFrames, frames - start),
			}),
		);
	return comp;
}

/** Three outputs from one job: film.mp4, threeD.mp4, vision.mp4. */
export async function all(): Promise<Record<string, Composition>> {
	return { film: await film(), threeD: await threeD(), vision: await vision() };
}

const single = async (scene: () => unknown, frames: number) => {
	const comp = await composition(frames);
	comp.add(scene() as never);
	return comp;
};

export const title = () => single(titleScene, TITLE_FRAMES);
export const media = () => single(mediaScene, MEDIA_FRAMES);
export const effects = () => single(effectsScene, EFFECTS_FRAMES);
export const charts = () => single(chartsScene, CHARTS_FRAMES);
