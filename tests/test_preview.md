# Preview Test

This file tests image rendering in the diff viewer's markdown preview mode.

## SVG Image (Relative Path)

![AC⚡DC Architecture](sample.svg)

## With Alt Text

Here is the architecture diagram:

![Architecture Diagram](./sample.svg)

## Inline Text Around Images

Some text before the image. ![inline svg](sample.svg) And some text after.

## Non-Existent Image

This should show a graceful fallback:

![Missing Image](does_not_exist.png)

## External URL (Should Pass Through)

![External](https://via.placeholder.com/150)

## Heading After Images

If you can see the SVG diagrams above, image rendering is working correctly.