import 'cross-fetch/polyfill'
import faugra from 'faugra'
const { log } = console

async function main() {
  const mutation = await faugra().createPost({
    data: {
      title: 'a post title',
      content: 'some post content',
      author: { create: { name: 'Whatever Name' } },
    },
  })

  log(`post created with id: ${mutation.createPost._id}\n`)

  log(await faugra().findPostByID({ id: mutation.createPost._id }))
}

main()

// Expected output of this script:

// post created with id: 262903814408897042
//
// {
//   findPostByID: {
//     title: 'a post title',
//     content: 'some post content',
//     author: { name: 'Whatever Name' }
//   }
// }
