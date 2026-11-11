import { expect, test } from "@playwright/test";

test("static entry loads and refreshes cleanly", async ({ page, baseURL }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("requestfailed", (request) => problems.push(request.url()));
  page.on("response", (response) => {
    if (!response.ok() && response.status() >= 400)
      problems.push(response.url());
  });

  const title = "BurrowProof: Swarms Under Siege";
  await page.goto("/");
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page).toHaveTitle(title);
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("main")).toContainText(title);
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
  expect(problems).toEqual([]);
});
