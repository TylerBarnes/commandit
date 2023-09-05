import { cmdit } from "../src/cmdit.js"

cmdit(`npx tsx ./examples/interactive.ts`, {
  verbose: true,
})
  .nextLineIs(`started!`)
  .whenLineIs(`waited`, async () => {
    console.log(`calling back`)
    await new Promise((res) => {
      setTimeout(res, 1000)
    })
  })
  .sendInput(`t`)
  .nextLineIs(`t pressed`, () => {
    console.log(`t pressed callback`)
  })
  .sendInput(`x`)
  .nextLineIs(`exiting`)
  .done()
