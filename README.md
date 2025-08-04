# 8086tiny.js
Adrian Cable's 8086tiny Ported to JavaScript (Node.js)<br>
<br>
# Build
> Step 1: Compile required binaries<br>

```bash
nasm bios.asm -o bios
gcc gettables.c -o gettables
./gettables > tables.js
```
> Step 2: Append BIOS tables to JS file<br>

The JavaScript file already has the BIOS tables hardcoded. <br>
If you change the tables, copy them from `tables.js` and replace the tables in `8086tiny.js`.

# Current Status
This emulator is just a port of the original 8086tiny code to JS.<br>
This code is mostly untested. If you can boot an OS with it, please send some information to me.<br>
