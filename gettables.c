/*
    gettables.c - Extracts BIOS opcode decoding tables from 'bios' file to stdout with JS format (const bios_table_lookup = ...;).
*/

#include <stdio.h>
#include <stdlib.h>
int main() {
    FILE* bios = fopen("bios", "rb");
    int size = 0;
    fseek(bios, 0, SEEK_END);
    size = ftell(bios);
    fseek(bios, 0, SEEK_SET);
    if (!bios) {
        perror("Cannot open 'bios', did you compile it?");
        exit(1);
    }
    unsigned char mem[0x10fff0];
    unsigned char* regs8;
    unsigned short* regs16 = (unsigned short*)(regs8 = 0xf0000 + mem);
    unsigned short reg_ip = 0x0100;
    regs16[9] = 0xf000;
    for (int i = 0; i < size && i < 0xff00; i++) {
        mem[(regs16[9] * 16) + reg_ip + i] = getc(bios);
    }

    unsigned char bios_table_lookup[20][256];
    printf("const bios_table_lookup = [");
    for (int i = 0; i < 20; i++) {
        printf("[");
        for (int j = 0; j < 256; j++) {
            bios_table_lookup[i][j] = regs8[regs16[0x81 + i] + j];
            printf("%d", bios_table_lookup[i][j]);
            if (j != 255) {
                printf(", ");
            }
        }
        printf("]");
        if (i != 19) {
            printf(", ");
        }
    }
    printf("];");
    printf("\n");

    return 0;
}
