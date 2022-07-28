DROP DATABASE darwin2;

/* development database parallels darwin design */

CREATE DATABASE IF NOT EXISTS darwin2;
USE darwin2;

select * from tasks2 where creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";
desc tasks2;
SHOW CREATE TABLE tasks2;

/* ############################################## */
/* VERSION 0 Initial tables instatiation */
CREATE TABLE IF NOT EXISTS profiles2 (
	PRIMARY KEY (id),
    id					INT			        NOT NULL AUTO_INCREMENT UNIQUE,
    name	 			VARCHAR(256)		NOT NULL,
    email				VARCHAR(256)		NOT NULL,
    subject				VARCHAR(64)			NOT NULL,
    userName			VARCHAR(256)		NOT NULL,
    region				VARCHAR(128)		NOT NULL,
    userPoolId			VARCHAR(128)		NOT NULL,
    create_ts	        TIMESTAMP 			NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts			TIMESTAMP			NULL ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domains2 (
    id 							INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    domain_name 				VARCHAR(32)	    NOT NULL,
    creator_fk 					INT				NULL,
    create_ts       			TIMESTAMP 		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles2 (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS areas2 (
    id							INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    area_name 					VARCHAR(32)	    NOT NULL,
    domain_fk					INT				NULL,
	creator_fk					INT				NULL,
    create_ts        			TIMESTAMP 		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles2 (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
	FOREIGN KEY (domain_fk)
        REFERENCES domains2 (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks2 (
    id		 					INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    priority					TINYINT			NOT NULL,
    done						TINYINT			NOT NULL,
    description					VARCHAR(256)	NOT NULL,
    area_fk						INT				NULL,
	creator_fk					INT				NULL,
    create_ts        			TIMESTAMP		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    done_ts     				TIMESTAMP		NULL,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles2 (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (area_fk)
        REFERENCES areas2 (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);


/* ############################################ */
/* insert development data use version 0 format */
INSERT INTO profiles2 (name, email, subject, userName, region, userPoolId)
VALUES ('Darwin Guy', 'darwintestuser@proton.me', '3af9d78e-db31-4892-ab42-d1a731b724dd', '3af9d78e-db31-4892-ab42-d1a731b724dd', 'us-west-1', 'us-west-1_jqN0WLASK');

INSERT INTO domains2 (domain_name, creator_fk) 
VALUES ('Art', 1);

INSERT INTO domains2 (domain_name, creator_fk) 
VALUES ('Garden', 1);

INSERT INTO domains2 (domain_name, creator_fk) 
VALUES ('Pool', 1);

INSERT INTO areas2 (area_name, domain_fk, creator_fk) 
VALUES ('Pencil Drawings', 1, 1);

INSERT INTO areas2 (area_name, domain_fk, creator_fk) 
VALUES ('Charcoal Drawings', 1, 1);

INSERT INTO areas2 (area_name, domain_fk, creator_fk) 
VALUES ('Play Dough', 1, 1);

INSERT INTO areas2 (area_name, domain_fk, creator_fk) 
VALUES ('Tomatoes', 2, 1);
 
INSERT INTO areas2 (area_name, domain_fk, creator_fk) 
VALUES ('Cucumbers', 2, 1);

INSERT INTO tasks2 (priority, done, description, area_fk, creator_fk) 
VALUES (true, false, "Draw a picture of Ava, Lia and Ella", 1, 1);

INSERT INTO tasks2 (priority, done, description, area_fk, creator_fk) 
VALUES (false, false, "Draw a picture of Parker", 1, 1);

INSERT INTO tasks2 (priority, done, description, area_fk, creator_fk) 
VALUES (false, true, "Draw the Niners beating the Seahawks", 1, 1);

INSERT INTO tasks2 (priority, done, description, area_fk, creator_fk) 
VALUES (true, false, "Stick Figures", 2, 1);

INSERT INTO tasks2 (priority, done, description, area_fk, creator_fk) 
VALUES (true, false, "A big ole house", 2, 1);

INSERT INTO tasks2 (priority, done, description, area_fk, creator_fk) 
VALUES (true, false, "Big Pizza", 3, 1);

INSERT INTO tasks2 (priority, done, description, area_fk, creator_fk) 
VALUES (true, false, "Plant them", 4, 1);

INSERT INTO tasks2 (priority, done, description, area_fk, creator_fk) 
VALUES (true, false, "Pick them", 5, 1);


/* ############################################ */
/* VERSION 1 - add closed field to areas */
ALTER TABLE areas2
ADD COLUMN closed TINYINT NOT NULL DEFAULT 0;


/* ############################################ */
/* VERSION 2 - add closed field to domains */
ALTER TABLE domains2
ADD COLUMN closed TINYINT NOT NULL DEFAULT 0;

DESC profiles4;

/* ############################################ */
/* VERSION 3 - Change profiles2 primary key id from an integer value
               to utilizing the 36 byte cognite user name */

/* DOMAINS modify dependent tables to drop FK by name first */
ALTER TABLE domains2
DROP FOREIGN KEY domains2_ibfk_1;

/* AREAS after the FK is dropped, the column can be dropped 
ALTER TABLE domains2
DROP COLUMN creator_fk; */

/* AREAS modify dependent tables to drop FK by name first */
ALTER TABLE areas2
DROP FOREIGN KEY areas2_ibfk_1;

/* AREAS after the FK is dropped, the column can be dropped 
ALTER TABLE areas2
DROP COLUMN creator_fk; */

/* TASKS modify dependent tables to drop FK by name first */
ALTER TABLE tasks2
DROP FOREIGN KEY tasks2_ibfk_1;

/* TASKS after the FK is dropped, the column can be dropped */
/* even in production, all data is from one user so this shortcut is ok 
ALTER TABLE tasks2
DROP COLUMN creator_fk; */

/* ########################## */

/* After all constrainst referring to the PK area dropped, drop profiles2 primary key */
ALTER TABLE profiles2
DROP COLUMN id;

/* create new id column as primary key, with space for the Cognito user name */
ALTER TABLE profiles2
ADD COLUMN id VARCHAR(64) PRIMARY KEY NOT NULL UNIQUE;

/* Set darwintestuser's correct Cognito userId as it's primary key */
UPDATE
	profiles2
SET
	id = "3af9d78e-db31-4892-ab42-d1a731b724dd"
WHERE
	email = "darwintestuser@proton.me";

/* ################ */

/* for each table referecing profiles2, add a new creator fk, update fk
   with the correct reference and then add the foreign key constraint */
ALTER TABLE domains2
MODIFY COLUMN creator_fk VARCHAR(64) NOT NULL;

UPDATE
    domains2
SET
    creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";

ALTER TABLE domains2 
ADD CONSTRAINT domains2_ibfk_1 FOREIGN KEY (creator_fk) REFERENCES profiles2(id) ON UPDATE CASCADE ON DELETE CASCADE;


ALTER TABLE areas2
MODIFY COLUMN creator_fk VARCHAR(64) NOT NULL;

UPDATE
    areas2
SET
    creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";

ALTER TABLE areas2 
ADD CONSTRAINT areas2_ibfk_1 FOREIGN KEY (creator_fk) REFERENCES profiles2(id);


ALTER TABLE tasks2
MODIFY COLUMN creator_fk VARCHAR(64) NOT NULL;

UPDATE
    tasks2
SET
    creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";

ALTER TABLE tasks2 
ADD CONSTRAINT tasks2_ibfk_1 FOREIGN KEY (creator_fk) REFERENCES profiles2(id) ON UPDATE CASCADE ON DELETE CASCADE;

/* END VERSION 3 CHANGES ###################################################### */

SELECT
	*
FROM
	profiles2;

SELECT
	*
FROM
	domains2;

SELECT
	*
FROM
	areas2;

SELECT
	*
FROM
	tasks2;


/* set user to have correct cognito name (in darwin and cognito database) */
UPDATE
	profiles2
SET
	id = "3af9d78e-db31-4892-ab42-d1a731b724dd"
WHERE
	email = "darwintestuser@proton.me";

/* add back the FK references using creator_fk column name */

SELECT
	*
FROM
	domains2;
    
DESC domains2;




SELECT
	*
FROM
	profiles2;



/* DIDN'T NEED: rename the new primary key to id */
ALTER TABLE profiles2
RENAME COLUMN id2 to id;

/* DIDN'T NEED: change it to a primary key */
ALTER TABLE profiles2
ADD PRIMARY KEY (id);

/* add the new FK with an appropriate default value to the existing tables */


DESC profiles2;

SHOW CREATE TABLE tasks2;

DESC profiles3;

SELECT
	*
FROM
	profiles2;




SHOW TABLES;
DESC areas2;




SELECT
	*
FROM
	profiles2;

/* Display a three table star join to confirm tables and constraints function */
SELECT 
    priority as 'Priority',
    done as 'Done',
    description as 'Description',
    areas2.area_name AS 'Area Name',
    profiles2.name AS 'User Name',
    tasks2.create_ts AS 'Created',
    tasks2.update_ts AS 'Updated',
    tasks2.done_ts AS 'Was Done'
FROM
    tasks2
        INNER JOIN profiles2
			ON tasks2.creator_fk = profiles2.id
		INNER JOIN areas2
			ON tasks2.area_fk = areas2.id;
            
