import { expect, type Frame, type Locator } from "@playwright/test";

export async function playFixture(frame: Frame, touch: boolean) {
  const activate = (element: Locator) => touch ? element.tap() : element.click();
  await expect(frame.locator(".slide")).toHaveCount(12);
  const jpeg = await frame.evaluate(async () => {
    const unique = new Map([...document.images].filter(img => img.src.startsWith("data:image/jpeg;base64,"))
      .map(img => [img.src, img]));
    const results = await Promise.all([...unique.values()].map(async (img) => {
      await img.decode();
      return img.naturalWidth > 0 && img.naturalHeight > 0;
    }));
    return { total: unique.size, decoded: results.filter(Boolean).length };
  });
  expect(jpeg).toEqual({ total: 9, decoded: 9 });
  for (let index = 0; index < 12; index += 1) {
    const slide = frame.locator(".slide").nth(index);
    await expect(slide).toHaveClass(/\bactive\b/);
    const controls = [
      [2, ".type-choice"], [4, ".origin-card"], [5, ".stage-btn"], [6, ".soil-band"], [7, ".profile-choice"],
    ] as const;
    const selector = controls.find(([at]) => at === index)?.[1];
    if (selector) {
      const buttons = await slide.locator(selector).all();
      expect(buttons.length).toBeGreaterThan(1);
      for (const button of buttons) await activate(button);
    }
    if (index === 9) {
      await activate(slide.locator("#photo-start"));
      for (let question = 0; question < 6; question += 1) {
        await activate(slide.locator("[data-photo-answer]").first());
        await expect(slide.locator("#photoq-feedback")).not.toBeEmpty();
        await activate(slide.locator(".photoq-next"));
      }
      await expect(slide.locator("[data-photo-answer]")).toHaveCount(0);
    }
    if (index === 10) {
      await activate(slide.locator("#start-quiz"));
      for (let question = 0; question < 15; question += 1) {
        await activate(slide.locator("[data-answer]").first());
        await expect(slide.locator("#quiz-explain")).not.toBeEmpty();
        await activate(slide.locator(".quiz-next"));
      }
      await expect(slide.locator("[data-answer]")).toHaveCount(0);
    }
    if (index === 11) await expect(frame.locator("#next")).toContainText("Od początku");
    if (touch) await frame.locator("#next").tap();
    else await frame.locator("#next").press("Enter");
  }
  await expect(frame.locator(".slide").first()).toHaveClass(/\bactive\b/);
  console.log(JSON.stringify({ sections: 12, jpeg, photoQuestions: 6, quizQuestions: 15, wraparound: true, input: touch ? "emulated tap" : "keyboard and pointer" }));
}
