declare module "nodemailer" {
  export type Transporter = {
    sendMail: (options: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
    }) => Promise<unknown>;
  };

  export function createTransport(options: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  }): Transporter;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
}

